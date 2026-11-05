import { readFileSync } from "node:fs";
import { parseVideo } from "../src/index.ts";

const html = readFileSync("sample.html", "utf8");
console.log(parseVideo(html));