import { readFileSync } from "node:fs";
import { parsePlayerUrls, getResolutions } from "../src/index.ts";

const html = readFileSync("sample.html", "utf8");

console.log(parsePlayerUrls(html));          // primero comprueba que encuentra algo
console.log(await getResolutions(html));     // luego el resultado final