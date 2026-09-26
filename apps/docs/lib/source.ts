import { docs } from "../.source/server";
import { loader } from "fumadocs-core/source";

const content = docs.toFumadocsSource();
// Keep README.md on GitHub while giving Fumadocs conventional folder index pages.
for (const file of content.files) {
  file.path = file.path.replace(/(^|\/)README\.md$/, "$1index.md");
}

export const source = loader({
  baseUrl: "/docs",
  source: content,
});
