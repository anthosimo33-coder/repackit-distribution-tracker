import { cleanupTestData } from "./helpers/cleanup";

async function globalTeardown() {
  console.log("🧹 Cleanup après tests...");
  await cleanupTestData();
}

export default globalTeardown;
