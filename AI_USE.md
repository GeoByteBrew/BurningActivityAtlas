# Use of AI tools in this project

This file states where and how AI tools ("Super Intelligence" tools in the wording of the NASA Space Apps
Challenge) were used. The same acknowledgement is carried as metadata: a header line in every source
file, an `ai_use` field in the `meta.json` of every web dataset, a closing line in the generated
reports, and a line in the About panel of the web application.

## Tools

Large language models used as coding and writing assistants, at every stage of the project. One of them is
Claude (Anthropic), used in a chat interface for the work listed in the second table. No image, video or
audio generation tool was used for the content of this repository.

## Where they were used

**The whole code base and its documentation were developed with AI assistance.** Every source file carries
a header line saying so.

| Part of the project | Use of AI tools |
|---|---|
| First version of the pipeline and of the web application (FIRMS client, quality control, grid, daily counts, first harmonization, CesiumJS + React dashboard) | Written with the assistance of an AI tool |
| Web application, later additions: "Your area" analysis (upload or draw a polygon), mobile layout, map controls (`web/src/components/AreaPanel.tsx`, `MapControls.tsx`, `aoi.ts`, `useMobile.ts`, and related changes) | Written with the assistance of an AI tool |
| FIRMS quota handling (`src/mvh/firms.py`), `config/multi_year.yaml`, `docs/07_nasa_submission.md` | Written with the assistance of an AI tool |

Work done with Claude (Anthropic):

| Part of the project | Use of the AI assistant |
|---|---|
| Python pipeline: `scripts/00`–`07`, `src/mvh/` (`config`, `grid`, `harmonize`, `qc`, `regions`, `store`, `temporal`) | Code rewritten or extended for the global scale: tile-partitioned processing, integer cell ids, country and sub-region lookup, outage screening, day/night factors, backup VIIRS platforms, factor uncertainty, validation tables, report and web export |
| Tests: `tests/` (unit tests, synthetic archive generator, end-to-end test) | Written with the AI assistant |
| Configuration: `config/config.yaml`, `config/world_test_2019.yaml` | Written or revised with the AI assistant |
| Documentation: `README.md`, `docs/01` to `docs/06`, this file | Drafted or revised with the AI assistant, from the team's decisions and from the results of the team's runs |
| Web application: dataset switcher, sensor comparison layers, timeline phases, method panel texts, legend and labels (`web/src/App.tsx`, `data.ts`, `types.ts`, `cesium/Globe.tsx`, `components/` AboutModal, CellDetail, ControlPanel, DownloadMenu, Header, InsightPanel, Legend, MethodPanel, Timeline, `styles/global.css`) | Code written or modified with the AI assistant |
| Review of results | The AI assistant read the validation report of the world run and pointed out its limits (low bias of the converted totals, volcanic and industrial sources, Eastern Asia); they are stated in the documentation |

## What is not AI-generated

- **Data.** All fire detections are NASA FIRMS products (MODIS MCD14ML, VIIRS VNP14IMG). The harmonized
  series, factors, validation tables and web datasets are computed from them by the pipeline. No value in
  any dataset, table or figure was produced by a generative model.
- **Figures.** The figures in `outputs/` are plots drawn by the pipeline (matplotlib) from the computed
  tables. The map is rendered by CesiumJS from the datasets.
- **Images, video, audio.** The repository contains no AI-generated image, video or audio.
- **NASA branding.** No NASA logo, flag or mission identifier is used, generated or modified. "NASA FIRMS"
  appears in text only, as the credit of the data source.

## Role of the team

The team defined the objective and the scope (a global record), chose between the options, supplied the
FIRMS archives, ran the pipeline on its own computers (world, 2003–2025) and produced the published
datasets and reports.
