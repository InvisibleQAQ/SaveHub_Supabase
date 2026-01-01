> 本文由 [简悦 SimpRead](http://ksria.com/simpread/) 转码， 原文地址 [medium.com](https://medium.com/@go-fireball/building-a-multimodal-rag-system-text-images-with-gpt-4o-pgvector-and-nuxt-4944f8810679)

> When people hear “Retrieval-Augmented Generation (RAG),” they often think it’s just prompt magic spri......

[

![](https://miro.medium.com/v2/resize:fill:32:32/1*uqlGEggk9j1Xl9vJE2rvng.png)

](https://medium.com/@go-fireball?source=post_page---byline--4944f8810679---------------------------------------)

Press enter or click to view image in full size

![](https://miro.medium.com/v2/resize:fit:700/1*sLn-l-7GEvukJpEIWSPQWQ.png)

When people hear “Retrieval-Augmented Generation (RAG),” they often think it’s just prompt magic sprinkled on top of an LLM. The reality is very different. A working RAG system isn’t built around prompts — it’s built on **data plumbing**: ingestion, chunking, embeddings, storage, and retrieval.

In this article, I’ll walk you through the process of designing and implementing a **multimodal RAG system from scratch**. By the end, you’ll understand the moving parts and how to wire them together into a working prototype that can handle text and images.

👉 Repo for reference: [github.com/go-fireball/rag-multimodal-demo](https://github.com/go-fireball/rag-multimodal-demo)

What is RAG? (and why does it matter)
-------------------------------------

At its core, RAG is a simple idea:

1. **Retrieve** relevant information from a knowledge base.
2. **Augment** the user’s query with that context.
3. **Generate** an answer using an LLM, grounded in the retrieved evidence.

The power of RAG is that you don’t need to train your own giant model. Instead, you combine:

* a search engine (for retrieval), and
* a pre-trained LLM (for reasoning).

The LLM doesn’t “know” everything. It makes more sense when you provide it with the correct supporting facts.

System Design: Breaking RAG into Pieces
---------------------------------------

For this project, I wanted to support not only text, but **also images**. This meant extending the classic RAG pipeline into a multimodal approach.

Here are the main building blocks we’ll create:

1. **Ingestion pipeline** — parse PDFs, extract text and images, generate captions.
2. **Embeddings** — convert text chunks and captions into dense vector representations.
3. **Vector store** — store those embeddings in pgvector for fast similarity search.
4. **Metadata store** — keep track of doc IDs, page numbers, section paths, etc.
5. **Retrieval layer** — run ANN search across both text and image vectors.
6. **Context builder** — assemble snippets and citations into a prompt.
7. **Answer generation** — use GPT-4o to produce grounded responses.

Let’s walk through each step.

### Step 1: Infrastructure Setup

We’ll start with a simple stack:

* **Postgres + pgvector**: database and vector search.
* **Docker Compose**: spin everything up locally.
* **Adminer**: lightweight UI to inspect the database.

This provides us with a sandbox environment that is free from external dependencies.

```
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: rag
      POSTGRES_PASSWORD: ragpw
      POSTGRES_DB: ragdb
    ports:
      - "5433:5432"
    volumes:
      - rag-data:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d

  adminer:
    image: adminer
    restart: always
    ports:
      - "8080:8080"

volumes:
  rag-data:
```

👉 **Tip:** If you clone the repo, you don’t need to copy this — it’s already in `[infra/docker-compose.yml](https://github.com/go-fireball/rag-multimodal-demo/blob/main/infra/docker-compose.yml)`

We use Postgres with **pgvector** to store both embeddings and metadata. The schema has three main tables:

1. `**documents**` – tracks each ingested PDF with title, source URI, and timestamp.
2. `**chunks**` – stores text snippets (with page, section, embedding, metadata). Indexed `ivfflat` for fast vector search.
3. `**figures**` – stores image-derived data (captions, OCR text, thumbnail, embedding). Also indexed for ANN search.

Example (Simplified)

```
CREATE TABLE chunks (
    chunk_id UUID PRIMARY KEY,
    doc_id UUID REFERENCES documents(doc_id),
    page INT,
    text TEXT,
    embedding vector(1536)
);


CREATE TABLE figures (
    figure_id UUID PRIMARY KEY,
    doc_id UUID REFERENCES documents(doc_id),
    page INT,
    caption_dense TEXT,
    embedding vector(1536)
);
```

👉 Full schema (with indexes, JSON metadata, etc.) is in the repo under `[infra/nitdb/01_init.sql](https://github.com/go-fireball/rag-multimodal-demo/blob/main/infra/initdb/01_init.sql)`

```
$ python -m rag.ingest_pdf ./samples/your_document_01.pdf
$ python -m rag.ingest_pdf ./samples/your_document_02.pdf
```

### Step 2: Ingestion — Getting Data In

RAG is only as good as the data you feed it. For PDFs, that means:

**Insert the document record:**

Every PDF receives a unique ID, allowing us to track all its chunks and figures.

```
doc_id = uuid.uuid4()
insert(
    "INSERT INTO documents(doc_id, title, source_uri) VALUES (%s,%s,%s)",
    (str(doc_id), Path(path).name, str(Path(path).resolve()))
)
print(f"Ingested {path}")
```

**Extracting text**:

We use **pdfplumber** to read each page, extract the text, and split it into smaller chunks (so embeddings fit within the model’s context window).

```
with pdfplumber.open(path) as pdf:
    for pnum, page in enumerate(pdf.pages, start=1):
        text = page.extract_text() or ""
        for chunk in split_text_into_chunks(text):
            emb = embed_text(chunk)
            insert(
                "INSERT INTO chunks(chunk_id, doc_id, page, section_path, text, embedding, meta) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (str(uuid.uuid4()), str(doc_id), pnum, None, chunk, emb, None)
            )
```

* Each chunk gets embedded with `embed_text()`.
* Stored in the `chunks` table along with its page number.

**Extracting images and captioning them**:

We use **PyMuPDF (fitz)** to extract embedded images, thumbnail them for the UI, and caption them with GPT-4.

```
for pnum, page in enumerate(pdf_doc, start=1):
    images = page.get_images(full=True)
    for idx, img in enumerate(images, start=1):
        base = pdf_doc.extract_image(img[0])
        image_bytes = base["image"]

      
        thumb_uri = save_thumb(pix, f"{doc_id}_{pnum}_{idx}")

      
        cap = caption_image_png(image_bytes)
        caption_dense = cap.get("global_caption_dense", "")
        ocr_text = "".join(cap.get("text_in_image", []) or [])

      
        emb = embed_text(caption_dense or cap.get("global_caption_short", ""))

        insert(
            """
            INSERT INTO figures(figure_id, doc_id, page, bbox, caption_short, caption_dense, 
                                ocr_text, thumb_uri, embedding, meta)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                str(uuid.uuid4()),
                str(doc_id),
                pnum,
                None,
                cap.get("global_caption_short"),
                caption_dense,
                ocr_text,
                thumb_uri,
                emb,
                Json(cap),
            ),
        )
```

* Each image → caption JSON (short caption, dense caption, OCR text, tags).
* Captions are embedded and stored in the `figures` table.
* Thumbnails can be served for retrieval.

**What we end up with:**

After ingestion, one PDF produces:

* **documents** — one row per file.
* **chunks** — multiple rows of embedded text chunks.
* **figures** — multiple rows of embedded image captions.

That’s the foundation of our RAG system. Now we can retrieve text or images by semantic similarity.

👉 **Full implementation:** See [ingest_pdf.py](https://github.com/go-fireball/rag-multimodal-demo/blob/main/apps/rag/src/rag/ingest_pdf.py) in the repo.

Here’s the pipeline at a glance:

```
┌───────────────┐
               │     PDF       │
               └───────┬───────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
 ┌──────▼───────┐              ┌──────▼───────┐
 │   Text       │              │   Images     │
 │ extraction   │              │ extraction   │
 │ (pdfplumber) │              │ (PyMuPDF)    │
 └──────┬───────┘              └──────┬───────┘
        │                             │
 ┌──────▼───────────┐         ┌───────▼───────-─────┐
 │ Split into       │         │ Caption with GPT-4o │
 │ smaller chunks   │         │ (short + dense +    │
 │ (chunking)       │         │ OCR + tags)         │
 └──────┬───────────┘         └────────┬───────-────┘
        │                              │
 ┌──────▼───────┐              ┌───────▼─────────┐
 │ Embed chunks │              │ Embed captions  │
 │ (OpenAI or   │              │ (OpenAI or      │
 │ alt. models) │              │ alt. models)    │
 └──────┬───────┘              └────────┬────────┘
        │                              │
 ┌──────▼─────────┐             ┌───────▼─────────┐
 │  chunks table  │             │  figures table  │
 │ (pgvector +    │             │ (pgvector +     │
 │ metadata)      │             │ metadata)       │
 └────────────────┘             └─────────────-───┘
```

### Step 3: Embeddings — Making Data Searchable

Embeddings enable us to make unstructured data searchable.

* Text chunks → embedding vectors.
* Image captions → embedding vectors.

Both sets of vectors are stored in pgvector. At query time, we’ll embed the user’s question in the same space and measure similarity.

Embeddings are how we turn raw text and captions into dense vectors that can be searched efficiently. In this repo, I’m using **OpenAI’s embeddings API** out of the box:

```
import os
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")

def embed_text(text: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        return []
    resp = client.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding
```

This works well for a prototype — it’s reliable, simple, and integrates cleanly with pgvector.

### 🔄 Swapping in Other Embedding Models

You don’t have to stick with OpenAI embeddings. The overall RAG design remains unchanged, regardless of whether you use a local or open-source model. A few popular alternatives:

Get go-fireball’s stories in your inbox
------------------------------------------

Join Medium for free to get updates from this writer.

**General text (English):**

* `all-MiniLM-L6-v2` – small, CPU-friendly, decent quality.
* `e5-base-v2` / `e5-large-v2` – strong retrieval performance.
* `bge-base-en-v1.5` – widely used in RAG setups.

**Multilingual:**

* `bge-m3` – multilingual + multi-function.
* `distiluse-base-multilingual-cased-v2`.

**Code-heavy corpora:**

* `bge-base-en-code`.

**Image embeddings (for figures):**

* OpenCLIP (e.g., ViT-B/32).
* SigLIP variants.

**One-command local serving (Ollama):**

* `nomic-embed-text`, `mxbai-embed-large`, `jina-embeddings-v3`, `snowflake-arctic-embed-l`, etc.

👉 **Practical tip:** If you’re experimenting, start with `**bge-base-en-v1.5**` for text and **OpenCLIP ViT-B/32** for images. They’re easy to run locally and give strong results without relying on an external API.

### **Step 4: Storing Data — Vector + Metadata**

Once we’ve chunked text and captioned images, we need a place to store them for fast retrieval. That’s where **Postgres with pgvector** comes in.

Our schema is split into three core tables:

`**documents**` **– the top-level record**

```
CREATE TABLE documents (
    doc_id UUID PRIMARY KEY,
    title TEXT,
    source_uri TEXT,
    ingested_at TIMESTAMP DEFAULT now()
);
```

`**chunks**` **– text snippets**

Each text chunk from a PDF is assigned its own row, including metadata and an embedding vector.

```
CREATE TABLE chunks (
    chunk_id UUID PRIMARY KEY,
    doc_id UUID REFERENCES documents(doc_id) ON DELETE CASCADE,
    page INT,
    section_path TEXT,
    text TEXT,
    embedding vector(1536),
    meta JSONB
);

CREATE INDEX idx_chunks_doc ON chunks(doc_id);
CREATE INDEX idx_chunks_embed ON chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

`**figures**` **– images and captions**

Each extracted image gets a row with captions, OCR text, thumbnail URI, and embedding.

```
CREATE TABLE figures (
    figure_id UUID PRIMARY KEY,
    doc_id UUID REFERENCES documents(doc_id) ON DELETE CASCADE,
    page INT,
    caption_short TEXT,
    caption_dense TEXT,
    ocr_text TEXT,
    thumb_uri TEXT,
    embedding vector(1536),
    meta JSONB
);

CREATE INDEX idx_figures_doc ON figures(doc_id);
CREATE INDEX idx_figures_embed ON figures
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### **Why split chunks vs figures?**

* **Chunks**: optimized for text-based retrieval (paragraphs, sentences).
* **Figures**: optimized for image-based retrieval (charts, diagrams).

By separating them, we can run **hybrid retrieval**: search text embeddings _and_ image embeddings, then blend results.

### Step 5: Retrieval — From Query ➜ Hits ➜ Grounded Answer

Retrieval turns a user question into **ranked evidence** from our vector store. Then we hand that evidence to the LLM to generate a **grounded** answer with citations.

At a high level, the `/query` endpoint does this:

1. Embed the user query
2. Search **text chunks** (and optionally **figure captions**) in pgvector
3. Pack snippets with citations
4. Ask the LLM to answer **using only** those snippets

**The FastAPI endpoint**

```
from fastapi import FastAPI
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
from openai import OpenAI

from .embeddings import embed_text
from .retrieval import search_text, search_figures
from .context import pack_snippets

load_dotenv()
app = FastAPI()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
ANSWER_MODEL = os.getenv("ANSWER_MODEL", "gpt-4o")

origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"], max_age=86400,
)

class QueryReq(BaseModel):
    query: str
    want_figures: bool = True
    k: int = 10
```

The retrieval flow (embed ➜ search ➜ pack ➜ answer)

```
@app.post("/query")
def query(req: QueryReq):
  
    qvec = embed_text(req.query)

  
    text_hits = search_text(qvec, k=req.k)
    fig_hits = search_figures(qvec, k=min(5, req.k)) if req.want_figures else []

  
    context = pack_snippets(text_hits, fig_hits)

  
    system = (
        "You are a precise assistant. Use ONLY the provided snippets. "
        "Cite claims like [doc:ID p:PAGE]. If answers aren't in snippets, say you don't know."
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Question: {req.query}\n\nSnippets:\n{context}"},
    ]

  
    resp = client.chat.completions.create(model=ANSWER_MODEL, messages=messages)
    return {
        "answer": resp.choices[0].message.content,
        "text_hits": text_hits,
        "figure_hits": fig_hits,
    }
```

The retrieval pipeline looks like this:

```
┌───────────────┐
               │  User Query   │
               └───────┬───────┘
                       │
               ┌───────▼────────┐
               │ Embed Query    │
               │ (text vector)  │
               └───────┬────────┘
                       │
        ┌──────────────┴─────────────┐
        │                            │
 ┌──────▼─────────┐           ┌──────▼─────────┐
 │ Search chunks  │           │ Search figures │
 │ (text vectors) │           │ (image vectors)│
 └──────┬─────────┘           └──────┬─────────┘
        │                            │
        └───────────┬────────────────┘
                    │
          ┌─────────▼──────────┐
          │ Pack snippets +    │
          │ inline citations   │
          └─────────┬──────────┘
                    │
          ┌─────────▼──────────┐
          │   GPT-4o Answer    │
          │ (grounded, cites   │
          │  [doc:ID p:PAGE])  │
          └────────────────────┘
```

### **What each step does:**

**Embed**: `embed_text()` Uses a configured embedding model to turn the query into a vector.

**Search**:

* `search_text(qvec, k)` queries the `chunks` table’s pgvector index.
* `search_figures(qvec, k)` queries the `figures` table’s pgvector index.

You can blend results later in the UI or within `pack_snippets`.

**Pack**: `pack_snippets()` formats results into a compact context block, adding inline citations like `[doc:ID p:PAGE]`.

**Constraint**: The system prompt **prohibits** using outside knowledge; if evidence is missing, the model must respond with “I don’t know.”

**Answer**: The LLM returns a concise answer plus citations.

### Step 6: UI — A Simple Nuxt 4 Frontend

A RAG system isn’t complete until users can actually query it. For this demo, I added a lightweight Nuxt 4 frontend (in `apps/web/`). It’s intentionally minimal, yet sufficient to test the pipeline.

The page has:

* An input box for the question
* A checkbox to include figures
* A section to display the answer
* Lists of text and figure hits, with metadata and thumbnails

Running the full stack

```
docker compose up -d


cd apps/rag
poetry run uvicorn rag.main:app --reload


cd apps/web
npm install
npm run dev
```

👉 With this, the prototype is truly end-to-end: **PDF ingestion → embeddings → vector DB → retrieval → grounded answer → simple web UI.**

```
┌─────────────────────────────┐
                                        │           User              │
                                        │  (Web UI – Nuxt page)       │
                                        └───────────────┬─────────────┘
                                                        │  HTTP POST /query
                                                        │  { query, want_figures }
                                                        ▼
                                      ┌──────────────────────────────────────┐
                                      │          FastAPI Backend             │
                                      │      (/ingest, /query endpoints)     │
                                      └───────────────┬───────────┬──────────┘
                                                      │           │
            (ingest PDFs)                             │           │ (answer)
                                                      │           │
    ┌───────────────────────────┐                     │           │
    │        Ingestion          │                     │           │
    │  pdfplumber (text)        │                     │           │
    │  PyMuPDF (images)         │                     │           │
    │  GPT-4o (image captions)  │                     │           │
    └───────────┬───────────────┘                     │           │
                │                                     │           │
       ┌────────▼────────┐                      ┌─────▼───────┐   │
       │  Embeddings     │                      │  Retrieval  │   │
       │  (text chunks + │   embed(query)       │  (pgvector) │   │
       │  figure captions│◄─────────────────────┤  Search     │   │
       │  → vectors)     │                      │  - chunks   │   │
       └────────┬────────┘                      │  - figures  │   │
                │                               └─────┬───────┘   │
                │   INSERT                                    │   │
                │   (vectors + metadata)                      │   │
┌───────────────▼───────────────┐                    ┌────────▼──────-───┐
│         Postgres              │                    │  Context Builder  │
│  • documents                  │   SELECT ANN       │  pack_snippets()  │
│  • chunks (vector index)      │◄───────────────────┤  + citations      │
│  • figures (vector index)     │   (cosine/ivfflat) └────────-┬─────────┘
└───────────────────────────────┘                              │
                                                               │  messages = [system,user]
                                                               ▼
                                                     ┌───────────────────────-┐
                                                     │        LLM (GPT-4o)    │
                                                     │  "Use ONLY snippets;   │
                                                     │   cite [doc:ID p:PAGE]"│
                                                     └───────────┬─────────-──┘
                                                                 │   answer + cites
                                                                 ▼
                                                      ┌───────────────────────┐
                                                      │        Web UI         │
                                                      │  - Answer (grounded)  │
                                                      │  - Text hits          │
                                                      │  - Figure hits + imgs │
                                                      └───────────────────────┘
```

**End-to-end flow:** PDFs are ingested into `documents`, `chunks`, and `figures` (with embeddings in pgvector). At query time, we embed the question, run an ANN search over text and image captions, and pack the top snippets with citations. We then ask the LLM to answer **using only that evidence**. The Nuxt UI displays the grounded answer, along with raw hits.

### Closing Thoughts

Building this multimodal RAG system from scratch taught me a simple but powerful lesson: **GenAI isn’t just about prompting models — it’s about data plumbing.**

* The **documents, chunks, and figures tables** form the backbone.
* **Embeddings** make unstructured data searchable.
* **Retrieval + context packing** is what keeps answers grounded.
* The **LLM** is just the final reasoning layer on top.

The magic happens when all these pieces fit together.

With this prototype, we can:

* Ask questions about text and images in a PDF.
* Get precise answers with citations.

👉 If you’re experimenting with RAG, my advice is to **start simple, measure what matters, and iterate**. Don’t get lost in infra complexity too early.

You can explore the repo here: [github.com/go-fireball/rag-multimodal-demo](https://github.com/go-fireball/rag-multimodal-demo)
