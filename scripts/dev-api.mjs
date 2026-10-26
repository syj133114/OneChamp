import { spawn } from 'node:child_process';
// Wrangler reads .dev.vars, or process environment when .dev.vars is absent. No secret CLI arguments.
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true';
const child = spawn('node', ['node_modules/wrangler/bin/wrangler.js','pages','dev','dist','--d1','DB=00000000-0000-0000-0000-000000000001','--binding','APP_ENV=development','--binding','RIOT_KEY_MODE=development','--port','8788','--ip','127.0.0.1'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
