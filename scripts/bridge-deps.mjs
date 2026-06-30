import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const MAVEN_REPO = process.env.MAVEN_REPO ?? 'https://repo.maven.apache.org/maven2';
const root = resolve(new URL('..', import.meta.url).pathname);
const libRoot = join(root, 'apps', 'bridge', 'lib');
const defaultGroupId = 'org.deepsymmetry';
const defaultArtifactId = 'beat-link';
const extraRuntimeCoordinates = [
  { groupId: 'org.slf4j', artifactId: 'slf4j-simple', version: '1.7.36' }
];

const args = parseArgs(process.argv.slice(2));
const rootCoordinate = {
  groupId: args.groupId ?? defaultGroupId,
  artifactId: args.artifactId ?? defaultArtifactId,
  version: args.version ?? await latestVersion(defaultGroupId, defaultArtifactId)
};

const pomCache = new Map();
const resolved = new Map();
const selectedArtifacts = new Map();

mkdirSync(libRoot, { recursive: true });
await resolveRuntime(rootCoordinate, new Map());
for (const coordinate of extraRuntimeCoordinates) {
  await resolveRuntime(coordinate, new Map());
}

for (const file of readdirSync(libRoot)) {
  if (file.endsWith('.jar')) {
    rmSync(join(libRoot, file));
  }
}

for (const artifact of selectedArtifacts.values()) {
  await downloadJar(artifact);
}

console.log(`Downloaded ${selectedArtifacts.size} runtime jar(s) to ${relative(libRoot)}.`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === '--version') {
      parsed.version = values[++index];
    } else if (value === '--group-id') {
      parsed.groupId = values[++index];
    } else if (value === '--artifact-id') {
      parsed.artifactId = values[++index];
    } else {
      throw new Error(`Unknown bridge dependency option: ${value}`);
    }
  }
  return parsed;
}

async function latestVersion(groupId, artifactId) {
  const metadata = await fetchText(`${artifactBaseUrl(groupId, artifactId)}/maven-metadata.xml`);
  return tag(metadata, 'release') ?? tag(metadata, 'latest') ?? fail(`No Maven metadata release found for ${groupId}:${artifactId}`);
}

async function resolveRuntime(coordinate, inheritedManagement) {
  const key = coordinateKey(coordinate);
  if (resolved.has(key)) {
    return;
  }
  resolved.set(key, true);

  const pom = await loadPom(coordinate);
  const packaging = pom.packaging ?? 'jar';

  if (packaging === 'jar') {
    selectArtifact(coordinate);
  }

  const dependencyManagement = new Map([...inheritedManagement, ...pom.dependencyManagement]);

  for (const dependency of pom.dependencies) {
    const scope = dependency.scope ?? 'compile';
    if (dependency.optional === 'true' || ['test', 'provided', 'system', 'import'].includes(scope)) {
      continue;
    }

    const managedVersion = dependencyManagement.get(`${dependency.groupId}:${dependency.artifactId}`);
    const version = dependency.version ?? managedVersion;
    if (!version) {
      console.warn(`Skipping ${dependency.groupId}:${dependency.artifactId}; no version found.`);
      continue;
    }

    await resolveRuntime({
      groupId: dependency.groupId,
      artifactId: dependency.artifactId,
      version
    }, dependencyManagement);
  }
}

function selectArtifact(coordinate) {
  const key = `${coordinate.groupId}:${coordinate.artifactId}`;
  const existing = selectedArtifacts.get(key);
  if (!existing || compareVersions(coordinate.version, existing.version) > 0) {
    selectedArtifacts.set(key, coordinate);
  }
}

function compareVersions(left, right) {
  const leftParts = left.split(/[.-]/);
  const rightParts = right.split(/[.-]/);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index] ?? '0';
    const rightPart = rightParts[index] ?? '0';
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    if (leftPart !== rightPart) {
      return leftPart.localeCompare(rightPart);
    }
  }

  return 0;
}

async function loadPom(coordinate) {
  const key = coordinateKey(coordinate);
  if (pomCache.has(key)) {
    return pomCache.get(key);
  }

  const pomText = await fetchText(`${artifactVersionBaseUrl(coordinate)}/${coordinate.artifactId}-${coordinate.version}.pom`);
  const cleanPom = stripComments(pomText);
  const parent = parseParent(cleanPom);
  const parentPom = parent ? await loadPom(parent) : null;
  const ownPom = withoutBlock(cleanPom, 'parent');
  const properties = new Map(parentPom?.properties ?? []);

  for (const [name, value] of parseProperties(ownPom)) {
    properties.set(name, value);
  }

  const groupId = resolveValue(tag(ownPom, 'groupId') ?? parentPom?.groupId, properties);
  const artifactId = resolveValue(tag(ownPom, 'artifactId'), properties);
  const version = resolveValue(tag(ownPom, 'version') ?? parentPom?.version, properties);
  const packaging = resolveValue(tag(ownPom, 'packaging'), properties);

  properties.set('project.groupId', groupId);
  properties.set('pom.groupId', groupId);
  properties.set('project.artifactId', artifactId);
  properties.set('pom.artifactId', artifactId);
  properties.set('project.version', version);
  properties.set('pom.version', version);

  const dependencyManagement = new Map(parentPom?.dependencyManagement ?? []);
  for (const dependency of parseDependencies(block(ownPom, 'dependencyManagement') ?? '', properties)) {
    if (dependency.version) {
      dependencyManagement.set(`${dependency.groupId}:${dependency.artifactId}`, dependency.version);
    }
  }

  const pom = {
    groupId,
    artifactId,
    version,
    packaging,
    properties,
    dependencyManagement,
    dependencies: parseDependencies(withoutBlock(ownPom, 'dependencyManagement'), properties)
  };

  pomCache.set(key, pom);
  return pom;
}

function parseParent(pomText) {
  const parent = block(pomText, 'parent');
  if (!parent) {
    return null;
  }
  return {
    groupId: tag(parent, 'groupId'),
    artifactId: tag(parent, 'artifactId'),
    version: tag(parent, 'version')
  };
}

function parseProperties(pomText) {
  const properties = block(pomText, 'properties');
  if (!properties) {
    return [];
  }
  return [...properties.matchAll(/<([A-Za-z0-9_.-]+)>([\s\S]*?)<\/\1>/g)].map((match) => [
    match[1],
    match[2].trim()
  ]);
}

function parseDependencies(pomText, properties) {
  return blocks(pomText, 'dependency').map((dependency) => ({
    groupId: resolveValue(tag(dependency, 'groupId'), properties),
    artifactId: resolveValue(tag(dependency, 'artifactId'), properties),
    version: resolveValue(tag(dependency, 'version'), properties),
    scope: resolveValue(tag(dependency, 'scope'), properties),
    optional: resolveValue(tag(dependency, 'optional'), properties),
    type: resolveValue(tag(dependency, 'type'), properties)
  })).filter((dependency) => {
    const type = dependency.type ?? 'jar';
    return dependency.groupId && dependency.artifactId && type === 'jar';
  });
}

function resolveValue(value, properties) {
  if (!value) {
    return value;
  }

  let resolved = value.trim();
  for (let attempts = 0; attempts < 10; attempts++) {
    const next = resolved.replace(/\$\{([^}]+)}/g, (match, name) => properties.get(name) ?? match);
    if (next === resolved) {
      return next;
    }
    resolved = next;
  }
  return resolved;
}

async function downloadJar(coordinate) {
  const url = `${artifactVersionBaseUrl(coordinate)}/${coordinate.artifactId}-${coordinate.version}.jar`;
  const target = join(libRoot, basename(url));
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, bytes);
  console.log(`Downloaded ${relative(target)}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function artifactBaseUrl(groupId, artifactId) {
  return `${MAVEN_REPO}/${groupId.replaceAll('.', '/')}/${artifactId}`;
}

function artifactVersionBaseUrl(coordinate) {
  return `${artifactBaseUrl(coordinate.groupId, coordinate.artifactId)}/${coordinate.version}`;
}

function coordinateKey(coordinate) {
  return `${coordinate.groupId}:${coordinate.artifactId}:${coordinate.version}`;
}

function stripComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}

function withoutBlock(value, name) {
  return value.replace(new RegExp(`<${name}[\\s\\S]*?<\\/${name}>`, 'g'), '');
}

function block(value, name) {
  const match = value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`));
  return match?.[1]?.trim() ?? null;
}

function blocks(value, name) {
  return [...value.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'g'))]
    .map((match) => match[1].trim());
}

function tag(value, name) {
  const match = value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`));
  return match?.[1]?.trim() ?? null;
}

function relative(path) {
  return path.replace(`${root}/`, '');
}

function fail(message) {
  throw new Error(message);
}
