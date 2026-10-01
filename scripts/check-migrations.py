import re, glob, sys
schema=open('prisma/schema.prisma').read()
sql="\n".join(open(f).read() for f in sorted(glob.glob('prisma/migrations/*/migration.sql')))
enums=set(re.findall(r'^enum (\w+)',schema,re.M))
sql_enums=set(re.findall(r'CREATE TYPE "(\w+)" AS ENUM',sql))
scalar={'String','Int','Boolean','DateTime','Float','Decimal','Json'}
cols={}
for t,body in re.findall(r'CREATE TABLE "(\w+)" \((.*?)\n\);',sql,re.S):
    cols[t]=set(re.findall(r'^\s+"(\w+)"',body,re.M))
# One ALTER TABLE may add several columns ("ADD COLUMN a …, ADD COLUMN b …") — Prisma's own format.
for t,body in re.findall(r'ALTER TABLE "(\w+)"(.*?);',sql,re.S):
    for c in re.findall(r'ADD COLUMN "(\w+)"',body): cols.setdefault(t,set()).add(c)
bad=0
for name,body in re.findall(r'^model (\w+) \{(.*?)^\}',schema,re.M|re.S):
    fields=set()
    for line in body.splitlines():
        p=line.split()
        if len(p)>=2 and not p[0].startswith(('@@','//')) and (p[1].rstrip('?[]') in scalar or p[1].rstrip('?[]') in enums): fields.add(p[0])
    if name not in cols: print("missing table",name); bad+=1; continue
    if fields!=cols[name]: print(name,"schema-only:",fields-cols[name],"sql-only:",cols[name]-fields); bad+=1
if enums!=sql_enums: print("enum mismatch", enums^sql_enums); bad+=1
# every @relation FK in schema has an ADD CONSTRAINT
fks=re.findall(r'CONSTRAINT "(\w+)_(\w+)_fkey" FOREIGN KEY',sql)
print(f"{len(cols)} tables, {len(sql_enums)} enums, {len(fks)} foreign keys — mismatches: {bad}")
sys.exit(1 if bad else 0)
