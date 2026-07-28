import sys
P='mnt/rac-xero-api-matt/server.js'
s=open(P,encoding='utf-8',newline='').read()   # preserve original line endings
edits=[]

# R1 — add plCategoryForType helper right after categoryForXeroType
r1_old=("function categoryForXeroType(type) {\n"
        "  return XERO_TYPE_CATEGORY[String(type || '').toUpperCase()] || null;\n"
        "}")
r1_new=r1_old+("\n\n"
"// P&L classification by Xero account TYPE (authoritative). Separates COGS from\n"
"// other expenses. Returns 'revenue' | 'cogs' | 'expense' | null.\n"
"function plCategoryForType(type) {\n"
"  const t = String(type || '').toUpperCase();\n"
"  if (t === 'REVENUE' || t === 'SALES' || t === 'OTHERINCOME') return 'revenue';\n"
"  if (t === 'DIRECTCOSTS') return 'cogs';\n"
"  if (t === 'EXPENSE' || t === 'OVERHEADS' || t === 'DEPRECIATN') return 'expense';\n"
"  return null;\n"
"}")
edits.append(('R1 helper', r1_old, r1_new))

# R2a — fetchProfitLossDirect: build the type map (its report call uses toDateStr — unique)
r2a_old="  const response = await xero.accountingApi.getReportProfitAndLoss(tenantId, fromDateStr, toDateStr);"
r2a_new=r2a_old+"\n  const typeMap = await buildAccountTypeMap(tenantId);"
edits.append(('R2a Direct typeMap', r2a_old, r2a_new))

# R2b — fetchProfitLossDirect: classify each row by TYPE, section title as fallback (single-quote/summary. — unique)
r2b_old=("      const category = categorizeSection(section.title);\n"
"      if (category === 'skip') return;\n"
"      section.rows.forEach((row) => {\n"
"        if (row.rowType === 'Row' && row.cells && row.cells.length >= 2) {\n"
"          const accountName = row.cells[0]?.value || '';\n"
"          if (accountName.toLowerCase().includes('total')) return;\n"
"          const amount = sumPLRowCells(row.cells);\n"
"          if (amount === 0) return;\n"
"          if (category === 'revenue') { summary.revenueAccounts.push({ name: accountName, amount }); summary.totalRevenue += amount; }")
r2b_new=("      const sectionCategory = categorizeSection(section.title);\n"
"      if (sectionCategory === 'skip') return;\n"
"      section.rows.forEach((row) => {\n"
"        if (row.rowType === 'Row' && row.cells && row.cells.length >= 2) {\n"
"          const accountName = row.cells[0]?.value || '';\n"
"          if (accountName.toLowerCase().includes('total')) return;\n"
"          const amount = sumPLRowCells(row.cells);\n"
"          if (amount === 0) return;\n"
"          // Account TYPE is authoritative (fixes OTHERINCOME accounts Xero's report layout\n"
"          // files under a non-income section, e.g. RAC grant accounts); section title is fallback.\n"
"          const category = plCategoryForType(typeMap.get(accountName.trim().toLowerCase())) || sectionCategory;\n"
"          if (category === 'revenue') { summary.revenueAccounts.push({ name: accountName, amount }); summary.totalRevenue += amount; }")
edits.append(('R2b Direct loop', r2b_old, r2b_new))

# R3a — fetchProfitLossData: build type map (its call ends with actualReportDateStr — unique)
r3a_old=("  const response = await xero.accountingApi.getReportProfitAndLoss(\n"
"    tenantId,\n"
"    fromDateStr,\n"
"    actualReportDateStr\n"
"  );")
r3a_new=r3a_old+"\n\n  const typeMap = await buildAccountTypeMap(tenantId);"
edits.append(('R3a Data typeMap', r3a_old, r3a_new))

# R3b — fetchProfitLossData: classify each row by TYPE (double-quote/plSummary. — unique)
r3b_old=('      const category = categorizeSection(section.title);\n'
'      if (category === "skip") return;\n'
'\n'
'      section.rows.forEach((row) => {\n'
'        if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {\n'
'          const accountName = row.cells[0]?.value || "";\n'
'          if (accountName.toLowerCase().includes("total")) return;\n'
'\n'
'          const amount = sumPLRowCells(row.cells);\n'
'          if (amount === 0) return;\n'
'\n'
'          if (category === "revenue") {\n'
'            plSummary.revenueAccounts.push({ name: accountName, amount });')
r3b_new=('      const sectionCategory = categorizeSection(section.title);\n'
'      if (sectionCategory === "skip") return;\n'
'\n'
'      section.rows.forEach((row) => {\n'
'        if (row.rowType === "Row" && row.cells && row.cells.length >= 2) {\n'
'          const accountName = row.cells[0]?.value || "";\n'
'          if (accountName.toLowerCase().includes("total")) return;\n'
'\n'
'          const amount = sumPLRowCells(row.cells);\n'
'          if (amount === 0) return;\n'
'\n'
'          // Account TYPE is authoritative; section title is fallback.\n'
'          const category = plCategoryForType(typeMap.get(accountName.trim().toLowerCase())) || sectionCategory;\n'
'          if (category === "revenue") {\n'
'            plSummary.revenueAccounts.push({ name: accountName, amount });')
edits.append(('R3b Data loop', r3b_old, r3b_new))

mode='write' if (len(sys.argv)>1 and sys.argv[1]=='write') else 'check'
CRLF='\r\n'
resolved=[]; ok=True
for name,old,new in edits:
    # target file uses mixed endings; match whichever variant is present, keep it
    matched=None
    for old_v,new_v in ((old,new),(old.replace('\n',CRLF),new.replace('\n',CRLF))):
        if s.count(old_v)==1:
            matched=(old_v,new_v); break
    if matched:
        end='CRLF' if CRLF in matched[0] else 'LF'
        print(f'{name}: OK (ending={end})'); resolved.append((name,)+matched)
    else:
        counts=(s.count(old), s.count(old.replace('\n',CRLF)))
        print(f'{name}: NO UNIQUE MATCH  counts(LF,CRLF)={counts}'); ok=False
if not ok:
    print('ABORT: not every target matched exactly once — no changes written.'); sys.exit(1)
if mode=='write':
    for name,old_v,new_v in resolved:
        s=s.replace(old_v,new_v,1)
    open(P,'w',encoding='utf-8',newline='').write(s)   # preserve endings on write
    print('WRITTEN. new size', len(s))
else:
    print('CHECK OK — all 5 targets matched exactly once. Re-run with "write" to apply.')
