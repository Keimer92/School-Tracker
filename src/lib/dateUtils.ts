
/**
 * Returns a date string in YYYY-MM-DD format based on local time.
 * Avoids UTC conversion issues with toISOString().
 * Uses manual padding for maximum compatibility.
 */
export const getLocalDateISOString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  
  return `${year}-${monthStr}-${dayStr}`;
};
