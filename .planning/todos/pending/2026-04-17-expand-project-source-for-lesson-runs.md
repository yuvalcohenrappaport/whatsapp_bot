---
created: 2026-04-17
title: Expand project list source beyond pm-authority sequences
area: api
files:
  - /home/yuval/pm-authority/services/http/routers/projects.py
---

## Problem

`GET /v1/projects` returns `SELECT DISTINCT project_name FROM sequences` — only projects that have had at least one lesson-mode generation run. Projects like weekly-audit, bodyguard agent, trading-automation server components, and other Mac/server projects don't appear in the dropdown because they've never been ingested into pm-authority's pipeline.

The owner wants the "New Lesson Run" form dropdown to show ALL projects across both machines, not just the 6 that have existing sequences.

## Solution

Expand the project source in `GET /v1/projects`. Options:

1. **Obsidian vault scan:** Read project digest filenames from `~/Documents/Obsidian Vault/wiki/projects/*.md` (or the server-synced copy). Each filename minus `.md` is a project name. Union with existing sequences. Requires the vault to be accessible from pm-authority's runtime.

2. **Static config file:** Add a `known_projects.json` or `projects` list in pm-authority's config that the owner maintains. Simple, no filesystem scanning.

3. **Both:** sequences table UNION vault scan UNION static config, deduplicated.

Also need to ensure `run_lesson_candidates_generation` can handle projects that have no `context_json` in sequences — either by reading the vault digest as context, or by prompting the owner to provide context at generation time via the topic_hint field.
