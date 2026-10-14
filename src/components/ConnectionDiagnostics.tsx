import type { ConnectionSnapshot } from '../domain/connection-diagnostics';

export default function ConnectionDiagnostics({ connection }: { connection?: ConnectionSnapshot }) {
  const bridge = connection?.bridge;
  const devices = Object.entries(connection?.devices ?? {}).filter(([, device]) => device.active);
  const received = (time: number | null) => time == null ? 'Not received' : 'Received';
  return (
    <details class="deck-card connection-diagnostics">
      <summary>Connection diagnostics</summary>
      <dl class="facts">
        <div class="fact--wide"><dt>Bridge registration</dt><dd>{bridge == null ? 'Waiting for bridge diagnostics' : bridge.running ? 'Registered' : 'Waiting for devices'}</dd></div>
        <div class="fact--wide"><dt>Network adapter</dt><dd>{bridge?.interfaceName ? `${bridge.interfaceName} · ${bridge.interfaceLabel ?? bridge.interfaceName}` : '-'}</dd></div>
        <div class="fact--wide"><dt>Bridge address</dt><dd>{bridge?.address ?? '-'}</dd></div>
        <div><dt>Bridge player</dt><dd>{bridge?.player ?? '-'}</dd></div>
        <div><dt>Own status sending</dt><dd>{bridge?.sendingStatus == null ? '-' : bridge.sendingStatus ? 'On' : 'Off'}</dd></div>
      </dl>
      {(bridge?.interfaces.length ?? 0) > 1 && <p class="diagnostic-warning">Multiple matching network adapters. Check the selected adapter if status data is missing.</p>}
      {(bridge?.interfaces.length ?? 0) > 0 && <ul class="diagnostic-interfaces" aria-label="Matching network adapters">{bridge!.interfaces.map(network => <li key={network.name}>{network.name} · {network.addresses.join(', ') || '-'}</li>)}</ul>}
      {devices.length > 0 ? <div class="diagnostic-reception"><table>
        <caption>Reception since connection / device return</caption>
        <thead><tr><th>Device</th><th>Announce</th><th>Status</th><th>Beats</th><th>Metadata</th></tr></thead>
        <tbody>{devices.map(([player, data]) => <tr key={player}>
          <th scope="row">{Number(player) >= 1 && Number(player) <= 6 ? `Player ${player}` : `Device ${player}`}</th>
          <td>{received(data.device)}</td><td>{bridge ? received(data.status) : 'Unknown'}</td><td>{received(data.beat)}</td><td>{received(data.metadata)}</td>
        </tr>)}</tbody>
      </table></div> : <p class="mixer-note">No device reception recorded.</p>}
      {devices.some(([player, data]) => Number(player) <= 6 && data.device !== null && data.status === null && bridge?.running === true) && <p class="diagnostic-warning">Device announced, but no deck status received. Check network adapter selection.</p>}
      <p class="mixer-note">Received means observed during this connection, not a packet-rate or freshness check. Beats may stop while paused. Mixer and metadata availability depends on the device. Status reception requires bridge diagnostics.</p>
    </details>
  );
}
