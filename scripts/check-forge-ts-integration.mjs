const packageNames = ['@mtg-forge-ts/core', '@mtg-forge-ts/cards', '@mtg-forge-ts/game'];
const report = { checkedAt: new Date().toISOString(), packages: {}, ready: true };
for (const name of packageNames) {
  try {
    const mod = await import(name);
    report.packages[name] = { available: true, exports: Object.keys(mod).sort() };
  } catch (error) {
    report.ready = false;
    report.packages[name] = { available: false, error: String(error?.message || error) };
  }
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ready ? 0 : 2;
