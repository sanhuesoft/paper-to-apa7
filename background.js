chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

    try {
        // Obtenemos la preferencia del usuario
        const settings = await chrome.storage.sync.get({ copyFormat: 'richText' });

        // Ejecutamos el script en la página
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: generateAndCopyAPA,
            args: [settings.copyFormat]
        });
    } catch (err) {
        console.error("Error en la extensión:", err);
    }
});

// Función principal que corre en la página web
async function generateAndCopyAPA(userFormat) {
    const getMeta = (names) => {
        for (let name of names) {
            const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
            if (el && el.content) return el.content.trim();
        }
        return "";
    };

    // 1. Extracción de Autores
    let rawAuthors = [];
    const authorNodes = document.querySelectorAll('meta[name="citation_author"]');
    if (authorNodes.length > 0) {
        rawAuthors = Array.from(authorNodes).map(n => n.content.trim());
    } else {
        const authorsEntry = getMeta(['citation_authors']);
        if (authorsEntry) {
            rawAuthors = authorsEntry.split(';').map(a => a.trim()).filter(a => a.length > 0);
        }
    }

    // 2. Extracción de Metadatos base
    let rawDate = getMeta(['citation_publication_date', 'citation_date', 'dc.date']);
    let year = "";
    if (rawDate) {
        const yearMatch = rawDate.match(/\d{4}/);
        if (yearMatch) year = yearMatch[0];
    }

    let title = getMeta(['citation_title', 'dc.title', 'og:title']) || document.title;
    let journal = getMeta(['citation_journal_title', 'citation_publisher']);
    let doi = getMeta(['citation_doi']);
    let volume = getMeta(['citation_volume']);
    let issue = getMeta(['citation_issue']);
    let url = window.location.href;

    // Filtro de discriminación
    if (rawAuthors.length === 0 && !doi && !journal) {
        alert("🔍 Formato no implementado aún.\n\nEste sitio no parece ser un artículo científico.");
        return;
    }

    // 3. Formateo de Autores APA 7
    let authorStr = "Autor desconocido.";
    if (rawAuthors.length > 0) {
        const formattedAuthors = rawAuthors.map(a => {
            let last, first;
            if (a.includes(',')) {
                let parts = a.split(',');
                last = parts[0].trim();
                first = parts[1] ? parts[1].trim() : "";
            } else if (a.includes(' ')) {
                let parts = a.split(' ');
                last = parts[0].trim();
                first = parts.slice(1).join(' ').trim();
            } else {
                last = a;
                first = "";
            }
            let initials = first ? first.split(/[\s\.]+/).filter(n => n).map(n => n.charAt(0).toUpperCase() + '.').join(' ') : "";
            return initials ? `${last}, ${initials}` : last;
        });

        if (formattedAuthors.length === 1) {
            authorStr = formattedAuthors[0];
        } else if (formattedAuthors.length <= 20) {
            const lastAuthor = formattedAuthors.pop();
            authorStr = `${formattedAuthors.join(', ')} & ${lastAuthor}`;
        } else {
            authorStr = `${formattedAuthors.slice(0, 19).join(', ')} ... ${formattedAuthors[formattedAuthors.length - 1]}`;
        }
    }

    // 4. Preparación de la Cita
    const finalYear = year || "s.f.";
    const titleClean = title.replace(/\s+/g, ' ').trim();
    const link = doi ? ` https://doi.org/${doi}` : ` ${url}`;
    
    let finalOutputHtml = "";
    let finalOutputPlain = "";

    if (userFormat === 'markdown') {
        let journalMd = journal ? ` _${journal}_` : "";
        let volumeMd = volume ? `, _${volume}_` : "";
        let issueStr = issue ? `(${issue})` : "";
        finalOutputPlain = `${authorStr} (${finalYear}). ${titleClean}.${journalMd}${volumeMd}${issueStr}.${link}`;
    } else {
        let journalHtml = journal ? ` <i>${journal}</i>` : "";
        let volumeHtml = volume ? `, <i>${volume}</i>` : "";
        let issueStr = issue ? `(${issue})` : "";
        finalOutputHtml = `${authorStr} (${finalYear}). ${titleClean}.${journalHtml}${volumeHtml}${issueStr}.${link}`;
        finalOutputPlain = finalOutputHtml.replace(/<[^>]*>/g, '');
    }

    // 5. Copiar al Portapapeles usando la API moderna (asíncrona)
    try {
        if (userFormat === 'richText') {
            const htmlBlob = new Blob([finalOutputHtml], { type: 'text/html' });
            const plainBlob = new Blob([finalOutputPlain], { type: 'text/plain' });
            const data = [new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': plainBlob
            })];
            await navigator.clipboard.write(data);
        } else {
            await navigator.clipboard.writeText(finalOutputPlain);
        }
        alert(`¡Cita copiada en formato ${userFormat}!\n\n` + finalOutputPlain);
    } catch (err) {
        console.error("Error al copiar:", err);
        alert("Error al copiar al portapapeles. Asegúrate de que la página tenga el foco.");
    }
}