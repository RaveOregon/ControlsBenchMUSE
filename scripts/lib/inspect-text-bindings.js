// Diagnostic: print text-binding target elements and the CSS rules that could style them.
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const svg = readFileSync(`${dir}/view.svg`, "utf8");
const bindings = JSON.parse(readFileSync(`${dir}/view-bindings.json`, "utf8")).bindings.filter(b => b.kind === "text");
for (const b of bindings) {
  const m = new RegExp(`<[^>]*id="${b.element}"[^>]*>`).exec(svg);
  console.log(b.channel.padEnd(24), m ? m[0] : "(missing)");
}
const css = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? "";
console.log("--- css rules mentioning val/text/fill none/data-cb ---");
for (const rule of css.split("}")) if (/\.val|text|data-cb|fill:\s*none|opacity/.test(rule)) console.log(`${rule.trim()}}`);
