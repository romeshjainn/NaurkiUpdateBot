'use strict';

/**
 * Resume generator — generates AI-improved resume PDF + optimized headline & summary.
 *
 * Flow:
 *   1. Read resume_faangpath.tex + resume.cls
 *   2. Call #1 → Groq: improve all bullet points (returns updated .tex)
 *   3. Compile updated .tex → PDF via tectonic, validate 1 page
 *   4. Call #2 → Groq: generate optimized headline + summary from improved .tex
 *      and the existing headline/summary scraped from Naukri
 *   5. Save PDF to resume/resume_generated.pdf
 *      Save headline + summary to resume/generated_profile.json
 *   6. Return { pdfPath, headline, summary }
 *
 * Usage (standalone):
 *   node src/resume_generator/generateResume.js
 *
 * Usage (imported):
 *   const { generateResume } = require('./resume_generator/generateResume');
 *   const { pdfPath, headline, summary } = await generateResume({ existingHeadline, existingSummary });
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const TEX_FILE = path.join(HERE, 'resume_faangpath.tex');
const CLS_FILE = path.join(HERE, 'resume.cls');
const OUT_DIR = path.join(HERE, 'resume');
const OUT_PDF = path.join(OUT_DIR, 'resume_generated.pdf');
const OUT_PROFILE = path.join(OUT_DIR, 'generated_profile.json');
const TECTONIC_BIN = path.join(
  HERE, '..', '..', 'tectonic_bin',
  process.platform === 'win32' ? 'tectonic.exe' : 'tectonic'
);

// ── Prompts ──────────────────────────────────────────────────────────────────

const RESUME_SYSTEM_PROMPT = `You are a senior technical resume writer specialising in software engineering resumes. \
Your task is to rewrite every single \\item bullet point to be stronger, sharper, and more \
impactful — while staying 100% truthful to the original content.

WHAT YOU MUST DO (apply to EVERY bullet — no bullet should be left unchanged):
- Start each bullet with a powerful, specific action verb (e.g. Architected, Spearheaded, \
Delivered, Reduced, Accelerated, Automated, Optimised, Shipped, Drove, Scaled)
- Cut filler words and passive voice — every word must earn its place
- Make the impact or outcome explicit if it is already implied in the original text
- Tighten long bullets — same meaning, fewer words, stronger punch
- Use precise technical language that resonates with senior engineers and hiring managers

ABSOLUTE RESTRICTIONS — violating any of these is a critical failure:
1. DO NOT add any number, percentage, or metric that does not already exist in the original \
— never fabricate data (no "40% faster", "3x improvement", "reduced by 30%" unless already there)
2. DO NOT add any skill, technology, tool, library, or framework not already present in the original
3. DO NOT change the LaTeX class, macros, formatting commands, or document structure
4. DO NOT add or remove sections, roles, projects, or bullet points
5. DO NOT change dates, company names, job titles, project names, or education details
6. DO NOT change the header (name, phone, email, links, tagline)
7. DO NOT alter text inside \\projectentry{}{...}, \\skillrow{}{...}, or any macro tag-list \
arguments — copy those arguments exactly character-for-character
8. Keep the exact same number of \\item bullets per section — never merge or split any
9. The resume MUST remain exactly 1 page — do not expand total content length
10. Return ONLY the raw .tex file content — no explanation, no markdown code fences, no preamble`;

const PROFILE_SYSTEM_PROMPT = `You are a senior technical recruiter and career coach specialising in software engineering profiles. \
Given an improved resume (LaTeX source) and the candidate's existing Naukri headline and summary, \
generate an optimized resume headline and profile summary for their Naukri profile.

HEADLINE RULES:
- Max 250 characters (Naukri limit)
- Lead with years of experience and strongest tech stack
- Include role title, key technologies, and one standout differentiator
- No generic fluff — every word must signal value to a hiring manager
- Do NOT fabricate experience, titles, or skills not in the resume

SUMMARY RULES:
- 150–300 words
- First sentence: who you are + strongest value proposition
- Body: 2–3 lines on key technical strengths with concrete examples from the resume
- Close: what you are looking for / open to
- Professional tone, first person, no bullet points, no markdown
- Do NOT fabricate any skill, project, or metric not present in the resume

OUTPUT FORMAT — return valid JSON only, no explanation, no markdown fences:
{
  "headline": "...",
  "summary": "..."
}`;

// ── Unicode char map — LLMs corrupt these; swap to placeholders ──────────────

const CHAR_MAP = [
  ['\u00b7', '__MIDDOT__'],   // · middle dot
  ['\u2013', '__ENDASH__'],   // – en dash
  ['\u2014', '__EMDASH__'],   // — em dash
  ['\u2019', '__RSQUO__'],    // ' right single quote
  ['\u201c', '__LDQUO__'],    // " left double quote
  ['\u201d', '__RDQUO__'],    // " right double quote
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an AI-improved resume PDF, headline, and summary.
 * @param {object} [options]
 * @param {string} [options.existingHeadline] - Current headline scraped from Naukri
 * @param {string} [options.existingSummary]  - Current summary scraped from Naukri
 * @returns {{ pdfPath: string, headline: string, summary: string }}
 */
async function generateResume({ existingHeadline = '', existingSummary = '' } = {}) {
  require('dotenv').config();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env');

  const texContent = fs.readFileSync(TEX_FILE, 'utf8');
  const clsContent = fs.readFileSync(CLS_FILE, 'utf8');

  // Replace non-ASCII with safe placeholders before sending to LLM
  let texForLlm = texContent;
  for (const [char, placeholder] of CHAR_MAP) {
    texForLlm = texForLlm.replaceAll(char, placeholder);
  }

  // ── Call #1: Improve resume bullets ─────────────────────────────────────────
  console.log('[ResumeGenerator] Call #1 — improving resume bullets...');
  const resumeResponse = await groqRequest(apiKey, [
    { role: 'system', content: RESUME_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'LaTeX class file (resume.cls) — for reference only, do not modify:\n\n' +
        clsContent +
        '\n\nResume source to improve (resume_faangpath.tex):\n\n' +
        texForLlm +
        '\n\nReturn only the complete updated .tex file.',
    },
  ]);

  let updatedTex = resumeResponse.choices[0].message.content.trim();

  // Strip markdown fences if the model wrapped its output
  if (updatedTex.startsWith('```')) {
    updatedTex = updatedTex
      .split('\n')
      .filter((l) => !l.startsWith('```'))
      .join('\n')
      .trim();
  }

  // Save raw LLM output for debugging
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'debug_llm_raw.tex'), updatedTex, 'utf8');

  // Restore original Unicode characters
  for (const [char, placeholder] of CHAR_MAP) {
    updatedTex = updatedTex.replaceAll(placeholder, char);
  }

  // Sanitize known LLM hallucinations in LaTeX environment names
  updatedTex = updatedTex.replace(/\\begin\{item[^}]*\}/g, '\\begin{itemize}');
  updatedTex = updatedTex.replace(/\\end\{item[^}]*\}/g, '\\end{itemize}');

  console.log('[ResumeGenerator] Call #1 done — compiling PDF...');
  const pdfPath = compileToPdf(updatedTex);

  // ── Call #2: Generate headline + summary ─────────────────────────────────────
  console.log('[ResumeGenerator] Call #2 — generating headline & summary...');
  const { headline, summary } = await generateProfileContent(
    apiKey, updatedTex, existingHeadline, existingSummary
  );

  // Persist so other scripts can read if needed
  fs.writeFileSync(
    OUT_PROFILE,
    JSON.stringify({ headline, summary, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  console.log('[ResumeGenerator] Profile content saved to', OUT_PROFILE);

  return { pdfPath, headline, summary };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function generateProfileContent(apiKey, resumeTex, existingHeadline, existingSummary) {
  const contextNote = (existingHeadline || existingSummary)
    ? `\n\nExisting Naukri headline (for context — improve on this):\n${existingHeadline || '(none)'}\n\nExisting Naukri summary (for context — improve on this):\n${existingSummary || '(none)'}`
    : '';

  const response = await groqRequest(apiKey, [
    { role: 'system', content: PROFILE_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Resume source (LaTeX):\n\n' +
        resumeTex +
        contextNote +
        '\n\nReturn only the JSON object with headline and summary.',
    },
  ]);

  let raw = response.choices[0].message.content.trim();

  // Strip markdown fences if present
  if (raw.startsWith('```')) {
    raw = raw.split('\n').filter((l) => !l.startsWith('```')).join('\n').trim();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.headline || !parsed.summary) throw new Error('Missing fields');
    return { headline: parsed.headline.trim(), summary: parsed.summary.trim() };
  } catch (err) {
    throw new Error(`Failed to parse profile JSON from Groq: ${err.message}\nRaw: ${raw.slice(0, 300)}`);
  }
}

function groqRequest(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.25,
      max_tokens: 4096,
    });

    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Groq API error ${res.statusCode}: ${data}`));
          } else {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse Groq response: ${e.message}`));
            }
          }
        });
      }
    );

    req.setTimeout(120000, () => req.destroy(new Error('Groq request timed out after 120s')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function compileToPdf(texContent) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));

  try {
    fs.copyFileSync(CLS_FILE, path.join(tmpDir, 'resume.cls'));

    // tectonic misrenders raw UTF-8 middle dot — use LaTeX command
    texContent = texContent.replace(/\u00b7/g, '\\textperiodcentered{}');

    const texPath = path.join(tmpDir, 'resume_generated.tex');
    fs.writeFileSync(texPath, texContent, 'utf8');

    const tectonicCmd = fs.existsSync(TECTONIC_BIN) ? TECTONIC_BIN : 'tectonic';
    const result = spawnSync(tectonicCmd, ['resume_generated.tex'], {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 120000,
    });

    const pdfPath = path.join(tmpDir, 'resume_generated.pdf');
    if (!fs.existsSync(pdfPath)) {
      throw new Error(
        'tectonic did not produce a PDF.\n' +
          (result.stdout || '').slice(-2000) +
          (result.stderr || '').slice(-2000)
      );
    }

    const pages = countPages(pdfPath);
    if (pages !== 1) {
      throw new Error(
        `Generated resume is ${pages} page(s) — expected exactly 1. Falling back to backup resume.`
      );
    }

    fs.copyFileSync(pdfPath, OUT_PDF);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('[ResumeGenerator] PDF saved to:', OUT_PDF);
  return OUT_PDF;
}

function countPages(pdfPath) {
  try {
    const buf = fs.readFileSync(pdfPath);
    const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  } catch {
    return 1;
  }
}

// ── Standalone entry point ────────────────────────────────────────────────────

if (require.main === module) {
  generateResume()
    .then(({ pdfPath, headline, summary }) => {
      console.log('\nGenerated PDF:', pdfPath);
      console.log('Headline:', headline);
      console.log('Summary:', summary.substring(0, 100) + '...');
    })
    .catch((err) => {
      console.error('Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { generateResume };
