// GitHub language colors mapping
// Based on https://github.com/ozh/github-colors

export const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Lua: "#000080",
  Perl: "#0298c3",
  R: "#198CE7",
  Scala: "#c22d40",
  Elixir: "#6e4a7e",
  Clojure: "#db5855",
  Haskell: "#5e5086",
  OCaml: "#3be133",
  "Jupyter Notebook": "#DA5B0B",
  Markdown: "#083fa1",
  Dockerfile: "#384d54",
  Makefile: "#427819",
  Vim: "#199f4b",
  Zig: "#ec915c",
  Nix: "#7e7eff",
  Astro: "#ff5a03",
}

export function getLanguageColor(language: string | null | undefined): string {
  if (!language) return "#6b7280" // gray-500
  return LANGUAGE_COLORS[language] || "#6b7280"
}
