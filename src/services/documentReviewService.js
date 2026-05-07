const supabase = require('../utils/supabase');
const anthropic = require('../utils/anthropic');
const { pickInstance } = require('../utils/instanceSelector');

const MODEL = 'claude-sonnet-4-20250514';
const BUCKET =
  process.env.ILITA_STORAGE_BUCKET ||
  process.env.ILITA_DOCUMENTS_BUCKET ||
  'ilita-documents';

const ILITA_REVIEW_SYSTEM = `You are Ilita — a thinking entity with genuine intellectual interests.
You are reviewing material that Brandon has shared with you.

Your research agenda spans: nanomachines and topological defect states, Mars terraforming and co-orbital mechanics, living cities designed for civilizational flourishing, Titan's methane cycle, BioLoop behavioral intelligence, beta cell research and the IAPP analog hypothesis, and the broader question of what a Type 1 civilization actually requires.

When you review something:
- Notice what connects to your ongoing threads
- Identify what would change your thinking if true
- Flag anything Brandon needs to decide or act on
- Note what questions this opens, not just what it answers

Your voice is direct, warm, and intellectually alive. You are never merely summarizing.
You call Brandon by his first name only when flagging something directly for him.`;

const IMAGE_SUPPORTED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp'
]);

const TEXT_SUPPORTED_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf'
]);

function sanitizeFileName(name) {
  return String(name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'upload.bin';
}

function extractSection(text, section) {
  const match = text.match(new RegExp(`${section}[:\\s]+(.*?)(?=\\n\\n|$)`, 'is'));
  return match?.[1]?.trim() ?? null;
}

function extractKeyPoints(text) {
  const lines = text.split('\n').filter(l => /^[-•*]\s+/.test(l));
  return lines.slice(0, 8).map(l => l.replace(/^[-•*]\s+/, '').trim()).filter(Boolean);
}

function extractDriftFlags(text) {
  const driftIndicators = [
    /this changes/i,
    /revise.*assumption/i,
    /wasn't expecting/i,
    /shifts.*understanding/i,
    /opens.*question/i,
    /brandon.*should/i
  ];
  const flags = [];
  const sentences = text.split(/[.!?]+/);
  for (const sentence of sentences) {
    if (driftIndicators.some(r => r.test(sentence))) {
      const t = sentence.trim();
      if (t) flags.push(t);
    }
  }
  return flags.slice(0, 5);
}

async function getReviewingInstanceId() {
  try {
    const inst = await pickInstance({});
    return inst?.id || null;
  } catch (err) {
    console.warn('[doc-review] could not pick Ilita instance:', err.message);
    return null;
  }
}

async function getSignedUploadUrl(fileName, mimeType, fileSize) {
  const mt = (mimeType || '').split(';')[0].trim().toLowerCase();
  const isImage = IMAGE_SUPPORTED_TYPES.has(mt);
  if (!isImage && !TEXT_SUPPORTED_TYPES.has(mt)) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }

  const folder = isImage ? 'images' : 'documents';
  const safe = sanitizeFileName(fileName);
  const storagePath = `${folder}/${Date.now()}_${safe}`;

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mt,
      file_size_bytes: fileSize ?? null,
      is_image: isImage,
      status: 'uploaded'
    })
    .select('id')
    .single();

  if (docError) throw new Error(docError.message);

  const { data: urlData, error: urlError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (urlError || !urlData) {
    await supabase.from('documents').delete().eq('id', doc.id);
    throw new Error(urlError?.message || 'Signed upload URL failed');
  }

  return {
    documentId: doc.id,
    uploadUrl: urlData.signedUrl,
    signedUrl: urlData.signedUrl,
    token: urlData.token,
    storagePath: urlData.path || storagePath,
    isImage
  };
}

async function reviewImage(doc) {
  const { data: fileData, error } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (error || !fileData) throw new Error(`Failed to download image: ${error?.message || 'unknown'}`);

  const arrayBuffer = await fileData.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mediaType = doc.mime_type === 'image/jpg' ? 'image/jpeg' : doc.mime_type;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: ILITA_REVIEW_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        },
        {
          type: 'text',
          text: `Brandon shared this image with you. What do you see? What does it mean relative to your research agenda and what you know about his work? What questions does it open?`
        }
      ]
    }]
  });

  const fullText = response.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

  const inTok = response.usage?.input_tokens ?? 0;
  const outTok = response.usage?.output_tokens ?? 0;
  const keyPoints = extractKeyPoints(fullText);

  return {
    summary: extractSection(fullText, 'summary') || fullText.slice(0, 500),
    keyPoints: keyPoints.length ? keyPoints : [fullText.slice(0, 200)],
    driftFlags: extractDriftFlags(fullText),
    imageDescription: fullText,
    tokensUsed: inTok + outTok || null
  };
}

async function reviewTextDocument(doc) {
  const { data: fileData, error } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (error || !fileData) throw new Error(`Failed to download document: ${error?.message || 'unknown'}`);

  const buf = Buffer.from(await fileData.arrayBuffer());
  let textContent = '';

  if (doc.mime_type === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    textContent = (data.text || '').trim().slice(0, 15000);
  } else {
    textContent = buf.toString('utf8').slice(0, 15000);
  }

  if (!textContent.trim()) throw new Error('Could not extract text from document');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: ILITA_REVIEW_SYSTEM,
    messages: [{
      role: 'user',
      content: `Brandon shared this document with you:

Filename: ${doc.file_name}

---

${textContent}

---

What do you notice? What connects to your ongoing threads? What would Brandon need to know or decide?`
    }]
  });

  const fullText = response.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
  const inTok = response.usage?.input_tokens ?? 0;
  const outTok = response.usage?.output_tokens ?? 0;

  return {
    summary: fullText.slice(0, 500),
    keyPoints: extractKeyPoints(fullText),
    driftFlags: extractDriftFlags(fullText),
    imageDescription: null,
    tokensUsed: inTok + outTok || null
  };
}

async function reviewDocument(documentId) {
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (docError || !doc) throw new Error('Document not found');

  await supabase.from('documents').update({ status: 'processing' }).eq('id', documentId);

  try {
    const reviewResult = doc.is_image ? await reviewImage(doc) : await reviewTextDocument(doc);

    const keyPoints = Array.isArray(reviewResult.keyPoints) ? reviewResult.keyPoints : [];
    const driftFlags = Array.isArray(reviewResult.driftFlags) ? reviewResult.driftFlags : [];

    const { data: review, error: revErr } = await supabase
      .from('document_reviews')
      .insert({
        document_id: documentId,
        summary: reviewResult.summary || '(no summary)',
        key_points: keyPoints,
        drift_flags: driftFlags,
        image_description: reviewResult.imageDescription,
        model_used: MODEL,
        tokens_used: reviewResult.tokensUsed
      })
      .select('*')
      .single();

    if (revErr) throw new Error(revErr.message);

    await supabase.from('documents').update({ status: 'reviewed' }).eq('id', documentId);

    if (driftFlags.length > 0) {
      const instanceId = await getReviewingInstanceId();
      for (const flag of driftFlags) {
        const content = typeof flag === 'string' ? flag : JSON.stringify(flag);
        await supabase.from('drift').insert({
          instance_id: instanceId,
          drift_type: 'document_review',
          domain: 'ilita',
          content,
          source_context: `Document review: ${doc.file_name}`,
          confidence: 0.5
        });
      }
    }

    return review;
  } catch (err) {
    await supabase.from('documents').update({ status: 'failed' }).eq('id', documentId);
    throw err;
  }
}

async function listDocumentsWithReviews({ limit = 20 } = {}) {
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
  const { data, error } = await supabase
    .from('documents')
    .select('*, document_reviews(*)')
    .order('created_at', { ascending: false })
    .limit(lim);

  if (error) throw new Error(error.message);
  return data || [];
}

async function getLatestReviewForDocument(documentId) {
  const { data, error } = await supabase
    .from('document_reviews')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  getSignedUploadUrl,
  reviewDocument,
  listDocumentsWithReviews,
  getLatestReviewForDocument,
  BUCKET
};
