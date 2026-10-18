import { handleMessage } from "../skills/searchSkill";

async function run() {
  const query = "Show me 3-bedroom condos in Irvine under $1.5M";
  console.log(`User: "${query}"\n`);

  const result = await handleMessage(query);
  console.log("Agent Response:\n");
  console.log(result.response);
}

run();
