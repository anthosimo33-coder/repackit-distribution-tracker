import { cleanupTestData } from "./helpers/cleanup";

async function globalSetup() {
  console.log("🧹 Cleanup avant tests...");
  await cleanupTestData();
}

export default globalSetup;
