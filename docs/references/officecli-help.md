# officecli --help 参考

> 本文档由 `vendor/officecli/officecli.exe --help` 的输出重定向生成，供 AI 在编写/修改文档处理工具时查阅。
> 二进制版本：**1.0.144**（生成时间：2026-08-23）

## 如何重新生成

二进制更新后，在项目根目录运行以下命令即可重新生成本文件：

```powershell
& '.\vendor\officecli\officecli.exe' --help
```

如需查看各格式（docx/xlsx/pptx）元素与属性的 schema 级能力参考，用 `help` 子命令：

```powershell
& '.\vendor\officecli\officecli.exe' help <format>                # 列出所有元素
& '.\vendor\officecli\officecli.exe' help <format> <verb>         # 支持该操作的元素
& '.\vendor\officecli\officecli.exe' help <format> <element>      # 元素完整细节
& '.\vendor\officecli\officecli.exe' help <format> <verb> <element>  # 按操作过滤
& '.\vendor\officecli\officecli.exe' help all --jsonl             # 全量 schema dump（NDJSON）
```

## 原始输出（officecli --help）

```
Description:
  officecli: AI-friendly CLI for Office documents (.docx, .xlsx, .pptx)

  Run 'officecli help' for the schema-driven capability reference (formats, elements, properties).
  See the Commands section below for the full list of subcommands.

Usage:
  officecli [command] [options]

Options:
  --json          Output as JSON (AI-friendly)
  -?, -h, --help  Show help and usage information
  --version       Show version information

Commands:
  open <file>                                Start a resident process to keep the document in memory for faster subsequent commands
  close <file>                               Flush in-memory changes to disk and stop the resident (releases the file). Use 'save' instead to flush but keep the resident warm. Either is needed before a non-officecli program reads the file; a live resident also auto-flushes shortly after going idle (adaptive 2-10s; see OFFICECLI_RESIDENT_FLUSH: each|auto|<seconds>|off).
  watch <file>                               Start a live preview server that refreshes when officecli modifies the document (external edits are not detected). Subcommands (mark/unmark/marks/goto) operate on the running preview.
  unwatch <file>                             Stop the watch preview server for the document
  view <file> <mode>                         View document in different modes
  get <file> <path>                          Get a document node by path [default: /]
  query <file> <selector>                    Query document elements with CSS-like selectors
  set <file> <path>                          Modify a document node's properties
  add <file> <parent>                        Add a new element to the document
  remove <file> <path>                       Remove an element from the document
  move <file> <path>                         Move an element to a new position or parent
  swap <file> <path1> <path2>                Swap two elements in the document
  refresh <file>                             Recalculate derived field values (TOC page numbers, PAGE/NUMPAGES, cross-references). Word + Windows required for .docx.
  raw <file> <part>                          View raw XML of a document part [default: /document]
  raw-set <file> <part>                      Modify raw XML in a document part (universal fallback for any OpenXML operation)
  add-part <file> <parent>                   Create a new document part and return its relationship ID for use with raw-set
  validate <file>                            Validate document against OpenXML schema
  save <file>                                Flush in-memory changes to disk, keeping the resident running. Run before a non-officecli program reads the file (officecli's own reads always see edits; a direct disk reader sees the pre-edit file until a flush). A live resident also auto-flushes shortly after going idle (adaptive 2-10s; see OFFICECLI_RESIDENT_FLUSH: each|auto|<seconds>|off). No-op if no resident is active.
  batch <file>                               Execute multiple commands from a JSON array in a single pass. Standalone, this is one open/save cycle; through a live resident the items apply in memory and the disk write is deferred to save/close/idle-autosave — adaptive 2-10s after going idle, or before the batch returns under OFFICECLI_RESIDENT_FLUSH=each (officecli's own reads still see the changes immediately).

                                             Each array item is an OBJECT whose "command" is the bare verb (add/set/remove/move/swap/get/query/...); the verb's arguments are SIBLING fields, not a CLI string inside "command". Common fields: "parent" (add target), "path" (set/remove/get target), "selector" (query filter; "path" is accepted as an alias), "type" (element type for add), "props" (a key->value map of --prop values), "to"/"after"/"before" (move), "path2" (swap's second path).

                                             Pass the array via --commands, or as the same JSON on stdin / --input <file>. Example:
                                             [
                                               {"command":"add","parent":"/slide[1]","type":"shape","props":{"text":"Hi","x":"1cm","y":"2cm"}},
                                               {"command":"set","path":"/slide[1]/shape[1]","props":{"bold":"true"}},
                                               {"command":"remove","path":"/slide[2]/shape[3]"}
                                             ]

                                             Text values follow the same rules as --prop on a single command: \n starts a new paragraph, \v is a line break within one. A .docx dump taken before that split encoded line breaks as \n; replay one by putting {"command":"meta","dumpVersion":1} first and its \n are read as line breaks again.

                                             Clean-slate replay (dump->batch into a fresh target): `create` refuses to overwrite an existing file (exit 1, code file_exists) and refuses one a live resident still holds (exit 1, code file_locked). A script that ignores create's exit code then replays onto the PREVIOUS run's document, so add style / add bookmark items fail with 'already exists'. Reliable idiom: close -> rm -> create -> batch -> close. rm BEFORE create matters: with the on-disk file gone, create auto-closes a resident still pinning that path; the leading close just covers the handle-release window. (`create --force` overwrites an existing file but does NOT release a resident lock — close first when a resident is up.)
  dump <file> <path>                         Serialize a document subtree into a replayable batch script (round-trip mechanism) [default: /]
  import <file> <parent-path> <source-file>  Import CSV/TSV data into an Excel sheet
  create <file>                              Create a blank Office document
  merge <template> <output>                  Merge template with JSON data, replacing {{key}} placeholders
  plugins                                    Manage and inspect installed plugins
  mcp                                        Start the MCP stdio server, or register/unregister officecli with an MCP client. Run 'officecli help mcp' for full usage.
  skills                                     Install agent skill definitions (Claude Code, Cursor, Copilot, ...). Run 'officecli help skills' for full usage.
  install                                    One-step setup: install binary + skills + MCP for detected agents. Run 'officecli help install' for full usage.
  help <format> <verb-or-element> <element>  Show schema-driven capability reference for officecli.


Schema Reference (docx/xlsx/pptx):
  officecli help <format>                         List all elements
  officecli help <format> <verb>                  Elements supporting the verb
  officecli help <format> <element>               Full element detail
  officecli help <format> <verb> <element>        Verb-filtered element detail
  officecli help <format> <element> --json        Raw schema JSON
  officecli help all                              Flat dump of every (format,element,property) — pipe to grep
  officecli help all --json                       Same dump as one envelope-wrapped JSON document
  officecli help all --jsonl                      Same dump as NDJSON (one JSON object per line)

  Formats: docx, xlsx, pptx
  Verbs:   add, set, get, query, remove
  Aliases: word→docx, excel→xlsx, ppt/powerpoint→pptx

Tip: most shells expand [brackets] — quote paths: officecli get doc.docx "/body/p[1]"
```
