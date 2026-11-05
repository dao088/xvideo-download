import { writeFileSync } from "node:fs";

const url = process.argv[2];
const res = await fetch(url, {
  redirect: "follow",
  headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
});
console.log("status:", res.status, "url final:", res.url);
writeFileSync("sample.html", await res.text());