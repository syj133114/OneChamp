import { readFile, writeFile } from 'node:fs/promises';
const id=process.argv[2];
if (!id || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || /^00000000-/.test(id)) {
  console.error('Usage: npm run db:configure -- <actual Cloudflare D1 database UUID>'); process.exit(1);
}
const file=new URL('../wrangler.jsonc',import.meta.url);
const config=JSON.parse(await readFile(file,'utf8'));
config.d1_databases=[{ binding:'DB',database_name:'onechamp',database_id:id,migrations_dir:'migrations' }];
await writeFile(file,JSON.stringify(config,null,2)+'\n');
console.log('Configured actual D1 binding. Next: npx wrangler d1 migrations apply onechamp --remote');
