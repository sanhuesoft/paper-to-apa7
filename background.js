chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

    try {
        const settings = await chrome.storage.sync.get({ copyFormat: 'richText' });

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: generateAndCopyAPA,
            args: [settings.copyFormat]
        });
    } catch (err) {
        console.error("Error en la extensión:", err);
    }
});

async function generateAndCopyAPA(userFormat) {
    const warningMsg = "\n\n⚠️ Verifique que los datos estén completos.";

    const getMeta = (names) => {
        for (let name of names) {
            const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
            if (el && el.content) return el.content.trim();
        }
        return "";
    };

    // --- PASO 1: INTENTAR CON METADATOS HTML ---
    let rawAuthors = [];
    const authorNodes = document.querySelectorAll('meta[name="citation_author"]');
    if (authorNodes.length > 0) {
        rawAuthors = Array.from(authorNodes).map(n => n.content.trim());
    } else {
        const authorsEntry = getMeta(['citation_authors']);
        if (authorsEntry) rawAuthors = authorsEntry.split(';').map(a => a.trim());
    }

    let rawDate = getMeta(['citation_publication_date', 'citation_date', 'dc.date']);
    let year = rawDate ? (rawDate.match(/\d{4}/) || [""])[0] : "";
    let title = getMeta(['citation_title', 'dc.title', 'og:title']) || document.title;
    let journal = getMeta(['citation_journal_title', 'citation_publisher']);
    let doi = getMeta(['citation_doi']);
    let volume = getMeta(['citation_volume']);
    let issue = getMeta(['citation_issue']);

    if (rawAuthors.length > 0 && title && title !== document.title) {
        processLocalCitation(rawAuthors, year, title, journal, volume, issue, doi, userFormat);
        return;
    }

    // --- PASO 2: SI FALLA, BUSCAR DOI EN EL TEXTO Y USAR CROSSREF ---
    const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
    const bodyText = document.body.innerText;
    const foundDoi = doi || (bodyText.match(doiRegex) || [null])[0];

    if (foundDoi) {
        try {
            const response = await fetch(`https://api.crossref.org/works/${foundDoi}`);
            if (!response.ok) throw new Error();
            const data = await response.json();
            const item = data.message;

            const crAuthors = (item.author || []).map(a => `${a.family}, ${a.given ? a.given.charAt(0) + '.' : ''}`);
            const crYear = item.published?.['date-parts']?.[0]?.[0] || item.created?.['date-parts']?.[0]?.[0] || "s.f.";
            const crTitle = item.title?.[0] || "Sin título";
            const crJournal = item['container-title']?.[0] || "";
            const crVolume = item.volume || "";
            const crIssue = item.issue || "";

            processLocalCitation(crAuthors, crYear, crTitle, crJournal, crVolume, crIssue, foundDoi, userFormat, true);
            return;
        } catch (e) {
            console.error("Error consultando CrossRef:", e);
        }
    }

    alert("🔍 No se detectaron metadatos ni un DOI válido en esta página.");

    async function processLocalCitation(authors, y, t, j, v, i, d, format, fromApi = false) {
        let authorStr = authors.length > 0 ? "" : "Autor desconocido.";
        if (authors.length > 0) {
            if (authors.length === 1) authorStr = authors[0];
            else if (authors.length <= 20) {
                const last = authors.pop();
                authorStr = `${authors.join(', ')} & ${last}`;
            } else {
                authorStr = `${authors.slice(0, 19).join(', ')} ... ${authors[authors.length - 1]}`;
            }
        }

        const titleClean = t.replace(/\s+/g, ' ').trim();
        const link = d ? ` https://doi.org/${d}` : ` ${window.location.href}`;
        const isMissing = !y || !j || !v || !i;

        // Versiones base para diferentes usos
        const basePlain = `${authorStr} (${y || 's.f.'}). ${titleClean}.${j ? ` ${j}` : ""}${v ? `, ${v}` : ""}${i ? `(${i})` : ""}.${link}`;
        const baseHtml = `${authorStr} (${y || 's.f.'}). ${titleClean}.${j ? ` <i>${j}</i>` : ""}${v ? `, <i>${v}</i>` : ""}${i ? `(${i})` : ""}.${link}`;
        const baseMarkdown = `${authorStr} (${y || 's.f.'}). ${titleClean}.${j ? ` _${j}_` : ""}${v ? `, _${v}_` : ""}${i ? `(${i})` : ""}.${link}`;

        let outHtml = "";
        let outPlain = "";

        // Definir qué va al portapapeles
        if (format === 'markdown') {
            outPlain = baseMarkdown;
        } else if (format === 'richText') {
            outHtml = baseHtml;
            outPlain = basePlain;
        } else {
            outPlain = basePlain;
        }

        // El mensaje del Alert siempre lleva la advertencia si faltan datos
        const alertMsg = basePlain + (isMissing ? warningMsg : "");

        try {
            const source = fromApi ? "vía CrossRef" : "vía Metadatos";
            
            if (format === 'richText') {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([outHtml], { type: 'text/html' }),
                    'text/plain': new Blob([outPlain], { type: 'text/plain' })
                })]);
            } else {
                await navigator.clipboard.writeText(outPlain);
            }
            
            alert(`¡Cita generada (${source})!\n\n${alertMsg}`);
        } catch (err) {
            alert("Error al copiar al portapapeles.");
        }
    }
}