export function getSupabaseErrorMessage(error: unknown): string {
  if (!error) return 'Error desconocido';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    const maybeDetails = (error as { details?: unknown }).details;
    if (typeof maybeDetails === 'string') return maybeDetails;
  }
  return String(error);
}

export function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code || '').trim();
  const message = getSupabaseErrorMessage(error).toLowerCase();

  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    message.includes('could not find the table') ||
    message.includes('schema cache') ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('does not exist')
  );
}
