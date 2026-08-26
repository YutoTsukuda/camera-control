/**
 * 実行前の環境チェック。
 *
 * Node の版が古いと、原因の分かりにくい構文エラーで落ちる。
 * Ubuntu 24.04 や Raspberry Pi OS の既定 Node は 18 系なので、
 * ブリッジ機で最初に踏みやすい。ここで先に明確に止める。
 */
export const REQUIRED_NODE_MAJOR = 22;

export function assertNodeVersion(version: string = process.versions.node): void {
  const major = Number(version.split('.')[0]);
  if (Number.isFinite(major) && major >= REQUIRED_NODE_MAJOR) return;

  console.error(
    [
      `Node.js ${REQUIRED_NODE_MAJOR} 以上が必要です（現在: v${version}）。`,
      '',
      'Debian / Ubuntu / Raspberry Pi OS:',
      `  curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash -`,
      '  sudo apt install -y nodejs',
      '',
      'nvm を使う場合:',
      `  nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`,
    ].join('\n'),
  );
  process.exit(1);
}
