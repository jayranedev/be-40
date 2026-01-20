const fs = require("fs");
const path = require("path");
const { buildPoseidon } = require("circomlibjs");

async function main() {
  const inputPath = process.argv[2] || "input.example.json";
  const outputPath = process.argv[3] || "input.json";
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  const data = JSON.parse(fs.readFileSync(resolvedInput, "utf8"));
  const poseidon = await buildPoseidon();
  const inputs = [...data.embedding, data.salt];
  const hash = poseidon.F.toString(poseidon(inputs));

  const output = {
    ...data,
    expectedCommitment: hash,
  };

  fs.writeFileSync(resolvedOutput, JSON.stringify(output, null, 2));
  console.log(`Wrote ${resolvedOutput}`);
  console.log(`expectedCommitment: ${hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
