import { verifyEmailSMTP } from "../src/lib/email-smtp-verifier";

const cases = [
  "paul@collective.work",
  "antoine.bidault@dastra.eu",
  "bguy@forsk.com",
  "eric.fourrier@gitguardian.com",
  "yves@wewardapp.com",
  "lnourry@training-orchestra.com",
  "nabil@strangebee.com",
  "sylvain.dumont@aldemia.fr",
  "jvallon@synanto.fr",
  "bbaccot@onestock-retail.com",
  "mgodart@semeia.io",
  "antoine@hublo.com",
  "loeck@hivebrite.com",
  "noreply.does.not.exist.fake@example.com", // doit être INVALID
];

async function main() {
  for (const email of cases) {
    const r = await verifyEmailSMTP(email);
    const icon = r.status === "VALID" ? "✅"
      : r.status === "INVALID" ? "❌"
      : r.status === "CATCH_ALL" ? "🟡"
      : "❓";
    console.log(`${icon} ${email.padEnd(45)} ${r.status.padEnd(10)} ${r.durationMs}ms ${r.detail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
