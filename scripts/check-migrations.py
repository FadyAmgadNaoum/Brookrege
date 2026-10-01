import re, glob, sys
schema=open('prisma/schema.prisma').read()
sql="\n".join(open(f).read() for f in sorted(glob.glob('prisma/migrations/*/migration.sql')))
enums=set(re.findall(r'^enum (\w+)',schema,re.M))
sql_enums=set(re.findall(r'CREATE TYPE "(\w+)" AS ENUM',sql))
scalar={'String','Int','Boolean','DateTime','Float','Decimal','Json'}
cols={}
# Replay the migrations in order, statement by statement: CREATE/DROP TABLE, ADD/DROP COLUMN
# (one ALTER TABLE may add or drop several columns — Prisma's own format).
for stmt in re.split(r';\s*\n', sql):
    stmt=re.sub(r'^\s*--.*$','',stmt,flags=re.M).strip()
    m=re.match(r'CREATE TABLE "(\w+)" \((.*)\)$',stmt,re.S)
    if m: cols[m.group(1)]=set(re.findall(r'^\s+"(\w+)"',m.group(2),re.M)); continue
    m=re.match(r'DROP TABLE (?:IF EXISTS )?"(\w+)"',stmt)
    if m: cols.pop(m.group(1),None); continue
    m=re.match(r'ALTER TABLE "(\w+)"(.*)$',stmt,re.S)
    if m:
        t,body=m.groups()
        for c in re.findall(r'ADD COLUMN "(\w+)"',body): cols.setdefault(t,set()).add(c)
        for c in re.findall(r'DROP COLUMN "(\w+)"',body): cols.get(t,set()).discard(c)
bad=0
for name,body in re.findall(r'^model (\w+) \{(.*?)^\}',schema,re.M|re.S):
    fields=set()
    for line in body.splitlines():
        p=line.split()
        if len(p)>=2 and not p[0].startswith(('@@','//')) and (p[1].rstrip('?[]') in scalar or p[1].rstrip('?[]') in enums): fields.add(p[0])
    if name not in cols: print("missing table",name); bad+=1; continue
    if fields!=cols[name]: print(name,"schema-only:",fields-cols[name],"sql-only:",cols[name]-fields); bad+=1
models=set(re.findall(r'^model (\w+) \{',schema,re.M))
for t in sorted(set(cols)-models): print("table only in migrations:",t); bad+=1
if enums!=sql_enums: print("enum mismatch", enums^sql_enums); bad+=1
# every @relation FK in schema has an ADD CONSTRAINT
fks=re.findall(r'CONSTRAINT "(\w+)_(\w+)_fkey" FOREIGN KEY',sql)
print(f"{len(cols)} tables, {len(sql_enums)} enums, {len(fks)} foreign keys — mismatches: {bad}")
sys.exit(1 if bad else 0)
