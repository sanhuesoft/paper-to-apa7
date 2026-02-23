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

    // Si tenemos autores y título, procedemos con la lógica local
    if (rawAuthors.length > 0 && title && title !== document.title) {
        processLocalCitation(rawAuthors, year, title, journal, volume, issue, doi, userFormat);
        return;
    }

    // --- PASO 2: SI FALLA, BUSCAR DOI EN EL TEXTO Y USAR CROSSREF ---
    // Buscamos un DOI en todo el cuerpo de la página usando Regex
    const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
    const bodyText = document.body.innerText;
    const foundDoi = doi || (bodyText.match(doiRegex) || [null])[0];

    if (foundDoi) {
        try {
            const response = await fetch(`https://api.crossref.org/works/${foundDoi}`);
            if (!response.ok) throw new Error();
            const data = await response.json();
            const item = data.message;

            // Extraer datos de CrossRef
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

    // --- PASO 3: SI NADA FUNCIONA ---
    alert("🔍 No se detectaron metadatos ni un DOI válido en esta página.");

    // Función interna para procesar y copiar
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

        let outHtml = "";
        let outPlain = "";

        if (format === 'markdown') {
            outPlain = `${authorStr} (${y || 's.f.'}). ${titleClean}.${j ? ` _${j}_` : ""}${v ? `, _${v}_` : ""}${i ? `(${i})` : ""}.${link}`;
        } else {
            outHtml = `${authorStr} (${y || 's.f.'}). ${titleClean}.${j ? ` <i>${j}</i>` : ""}${v ? `, <i>${v}</i>` : ""}${i ? `(${i})` : ""}.${link}`;
            outPlain = outHtml.replace(/<[^>]*>/g, '');
        }

        const finalPlain = outPlain + (isMissing ? warningMsg : "");
        const finalHtml = outHtml + (isMissing ? "<br><br>⚠️ Verifique que los datos estén completos." : "");

        try {
            const source = fromApi ? "vía CrossRef" : "vía Metadatos";
            if (format === 'richText') {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([finalHtml], { type: 'text/html' }),
                    'text/plain': new Blob([finalPlain], { type: 'text/plain' })
                })]);
            } else {
                await navigator.clipboard.writeText(finalPlain);
            }
            alert(`¡Cita generada (${source})!\n\n${finalPlain}`);
        } catch (err) {
            alert("Error al copiar al portapapeles.");
        }
    }
}