// Intentional compatibility break: the old name deployed the preview, never a production target.
console.error('deploy:production is disabled. Use deploy:preview only when intending the existing preview target.');
process.exitCode=1;
