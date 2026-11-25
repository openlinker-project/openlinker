/**
 * The channel-reported status is free text on the wire; the known transport
 * values get a translated label, anything else is shown as the source said it.
 */
export function orderStatusLabel(
  status: string,
  labels: Readonly<Record<string, string>>,
): string {
  return Object.prototype.hasOwnProperty.call(labels, status) ? labels[status] : status;
}
