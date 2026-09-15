/**
 * Downloads a list of recovery codes as a formatted .txt file.
 *
 * @param {string[]} codes - Array of recovery code strings
 * @param {string} [username='user'] - The account username
 * @returns {boolean} Whether download was triggered
 */
export function downloadRecoveryCodesFile(codes, username = 'user') {
  if (!Array.isArray(codes) || codes.length === 0) {
    return false;
  }

  const safeUsername = String(username || 'user').trim() || 'user';
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFormatted = now.toLocaleTimeString('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dateStamp = now.toISOString().slice(0, 10);

  const fileLines = [
    '================================================================',
    '  MEALS OPERATIONS WORKSPACE - BACKUP RECOVERY CODES',
    '================================================================',
    '',
    `Account:       @${safeUsername}`,
    `Generated:     ${dateFormatted} at ${timeFormatted} (PHT)`,
    `Total Codes:   ${codes.length}`,
    '',
    '----------------------------------------------------------------',
    '  IMPORTANT INSTRUCTIONS & SECURITY NOTICE',
    '----------------------------------------------------------------',
    '• Each backup recovery code can only be used ONCE.',
    '• Use a recovery code when you cannot access your Authenticator App.',
    '• Store this text file in a secure, encrypted folder or password manager.',
    '• Generating a new set of codes will permanently invalidate these codes.',
    '',
    '----------------------------------------------------------------',
    '  YOUR ONE-TIME BACKUP RECOVERY CODES',
    '----------------------------------------------------------------',
    '',
    ...codes.map((code, index) => {
      const num = String(index + 1).padStart(2, '0');
      return `  [ ${num} ]   ${code}`;
    }),
    '',
    '================================================================',
    '  Keep this document confidential. Do not share these codes.',
    '================================================================',
    '',
  ];

  const content = fileLines.join('\r\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `meals-recovery-codes-${safeUsername}-${dateStamp}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
}
