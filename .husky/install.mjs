// CI and production installs do not need Git hooks or development dependencies.
if (process.env.CI || process.env.NODE_ENV === 'production' || process.env.HUSKY === '0') {
  process.exit(0);
}
const { default: husky } = await import('husky');
const result = husky();
if (result) {
  console.error(result);
  process.exitCode = 1;
}
