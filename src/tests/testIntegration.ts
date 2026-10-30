import { closeConnection } from "../db/connection.ts";
import { handleMessage } from "../skills/searchSkill.ts";

async function run() {
  const query = "Show me 3-bedroom condos in Irvine";
  console.log(`User: "${query}"\n`);

  const result = await handleMessage(query, "user_123");
  console.log("Agent Response:\n");
  console.log(result.response);

  const result2 = await handleMessage("my maximum budget is 100k", "user_123");
   
  console.log("Agent Response2:\n");
  console.log(result2.response);

  await closeConnection();
}

run();
