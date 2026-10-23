// Prints a full scenario, including hidden layers, for inspecting the generator.
// Usage: npm run generate -- [--seed 123] [--offline]

import { generateScenario } from "../scenarioService";

const args = process.argv.slice(2);
const seedIndex = args.indexOf("--seed");
const seed = seedIndex >= 0 ? Number(args[seedIndex + 1]) : undefined;

const { scenario, warnings } = await generateScenario({ seed, offline: args.includes("--offline") });
console.log(JSON.stringify(scenario, null, 2));
for (const warning of warnings) console.error(`WARNING: ${warning}`);
