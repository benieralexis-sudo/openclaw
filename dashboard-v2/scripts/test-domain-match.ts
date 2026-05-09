import { domainMatchesCompany } from "../src/lib/verify-persona-coherence";

const cases: { email: string; company: string; expect: boolean }[] = [
  { email: "maeva.courtois@younited-credit.fr", company: "helios", expect: false },
  { email: "nabboud@taragaming.com", company: "Novaquark", expect: false },
  { email: "fontenoy@compass-group.fr", company: "eXalt", expect: false },
  { email: "jonathan.marin@teledyne.com", company: "Shape It", expect: false },
  { email: "jl.wirotius@mistertemp-group.com", company: "LYNX RH", expect: false },
  { email: "eric.lacomblez@ouidesk.com", company: "Insitoo", expect: false },
  { email: "paul@collective.work", company: "Collective.work", expect: true },
  { email: "antoine.bidault@dastra.eu", company: "Dastra", expect: true },
  { email: "yves@wewardapp.com", company: "WeWard", expect: true },
  { email: "lnourry@training-orchestra.com", company: "Training Orchestra", expect: true },
  { email: "bguy@forsk.com", company: "Forsk", expect: true },
  { email: "eric.fourrier@gitguardian.com", company: "GitGuardian", expect: true },
  { email: "test@gmail.com", company: "Forsk", expect: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = domainMatchesCompany({ email: c.email, companyName: c.company });
  const ok = r.ok === c.expect;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${c.email} + "${c.company}" → ok=${r.ok}${r.reason ? ` (${r.reason})` : ""}${ok ? "" : ` EXPECTED ${c.expect}`}`);
}
console.log(`\n${pass}/${pass+fail} pass`);
