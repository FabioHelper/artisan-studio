// "Precisão" screen (T-016): the scale checks are turned into a macrofy.bench/1 manifest plus predictions (web/estimate/calibration.mjs) and scored by the
// same evaluation engine the repo uses (vendor/metrics.mjs, a copy of eval/metrics.mjs; bootstrap by capture day). Also the other-app comparison and the
// checks export. Pure numbers come from vendor/calibration.mjs; this file is DOM only.
import * as cal from './vendor/calibration.mjs';
import { evaluate } from './vendor/metrics.mjs';
import { createLookup } from './vendor/lookup-core.mjs';

const pct = (x, d = 1) => (x === null || x === undefined ? 'n/d' : `${(x * 100).toFixed(d).replace('.', ',')} %`);
const signed = (x) => (x === null || x === undefined ? 'n/d' : `${x > 0 ? '+' : ''}${pct(x)}`);
const ci = (c, fmt = pct) => (c ? `intervalo de 95%: ${fmt(c.lo)} a ${fmt(c.hi)}` : 'sem intervalo');
const n0 = (x) => String(Math.round(x));

export function createAccuracy(ctx) {
  const { h, show, back, errorBox, db, objUrl, isoWithOffset, getVocab } = ctx;

  async function screenAccuracy() {
    const [checks, scale] = await Promise.all([db.getAll('checks'), db.getSetting('scale')]);
    let acc = null; let problem = '';
    try { acc = cal.accuracy(checks, { evaluate, truthNutrients: createLookup(getVocab()).truthNutrients, scale: scale?.model ? { model: scale.model, resolution_g: scale.resolution_g || 1 } : null }); }
    catch (e) { problem = `Não consegui calcular a precisão: ${e.message}`; }

    const file = new File([JSON.stringify(cal.exportChecks(checks, { scale: scale?.model ? { model: scale.model, resolution_g: scale.resolution_g || 1 } : null, exported_at: isoWithOffset() }), null, 2)], 'checks.json', { type: 'application/json' }); // built now: iOS needs a fresh tap to share
    const msg = h('div');
    const download = () => { const a = h('a', { href: objUrl(file), download: 'checks.json' }); document.body.append(a); a.click(); a.remove(); };
    const doExport = async () => {
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Macrofy conferências' }); msg.replaceChildren(h('div', { class: 'good' }, 'Conferências compartilhadas.')); return; } }
      catch (err) { if (err.name === 'AbortError') return; }
      download(); msg.replaceChildren(h('div', { class: 'good' }, 'Arquivo checks.json baixado.'));
    };

    const metric = (id, title, value, detail) => h('div', { class: 'card', id }, h('div', { class: 'muted' }, title), h('p', { class: 'big' }, value), h('div', { class: 'muted' }, detail));
    const body = [];
    if (!acc) body.push(h('p', { class: 'muted', id: 'acc-empty' }, checks.length ? 'Nenhuma conferência pode ser pontuada ainda (falta a foto ou os gramas).' : 'Nenhuma conferência ainda. Depois de uma estimativa, toque em "Conferir com balança" e digite os gramas.'));
    else {
      const mk = acc.meal_kcal; const im = acc.item_mass; const iv = acc.interval80;
      body.push(
        h('div', { class: 'card', id: 'acc-n' }, h('strong', {}, `${acc.n_checks} conferência${acc.n_checks === 1 ? '' : 's'} em ${acc.days} dia${acc.days === 1 ? '' : 's'}`),
          h('div', { class: 'muted' }, `${acc.n_item_checks} por item, ${acc.n_checks - acc.n_item_checks} só com o total do prato. A mesma foto conferida duas vezes conta uma vez.`)),
        acc.needs_more ? h('div', { class: 'banner', role: 'status', id: 'acc-more' }, `Ainda precisa de mais conferências (menos de ${cal.MIN_CHECKS_FOR_ACCURACY}): com tão poucas, os números abaixo e os intervalos não dizem quase nada.`) : null,
        acc.days < 3 && !acc.needs_more ? h('div', { class: 'banner', role: 'status' }, 'Poucos dias diferentes: o intervalo de 95% (sorteio por dia de captura) ainda é frágil.') : null,
        metric('acc-kcal', 'Erro de calorias por refeição (MAPE)', pct(mk.mape), `${ci(mk.ci95?.mape)} · ${mk.n} refeições`),
        im ? metric('acc-mass', 'Erro de massa por item (MAPE)', pct(im.mape), `${ci(im.ci95?.mape)} · ${im.n} itens`) : h('p', { class: 'muted', id: 'acc-mass' }, 'Erro de massa por item: digite os gramas por item (não só o total) para calcular.'),
        im ? metric('acc-bias', 'Viés da massa (+ = a estimativa passa do peso)', signed(im.bias), `${ci(im.ci95?.bias, signed)} · ${im.n} itens`) : null,
        iv && iv.coverage !== null ? metric('acc-cover', 'Faixas de 80% que cobrem o peso da balança', pct(iv.coverage, 0), `${ci(iv.ci95, (x) => pct(x, 0))} · ${iv.n} itens`) : null);
      const oa = acc.other_app;
      body.push(h('h2', {}, 'Nosso kcal, o do outro app e a balança'),
        oa.n ? h('div', { id: 'acc-other' }, h('div', { class: 'card' },
          h('table', { style: 'width:100%;border-collapse:collapse' }, h('thead', {}, h('tr', {}, ['Refeição', 'Macrofy', 'Outro app', 'Balança'].map((t) => h('th', { style: 'text-align:right' }, t)))),
            h('tbody', {}, oa.rows.map((r) => h('tr', { 'data-other-row': r.id }, [r.day.split('-').reverse().slice(0, 2).join('/'), `${n0(r.ours)} kcal`, `${n0(r.theirs)} kcal`, `${n0(r.truth)} kcal`].map((t) => h('td', { style: 'text-align:right' }, t)))))),
          h('p', { class: 'muted' }, `Erro médio contra a balança: Macrofy ${pct(oa.ours_mape)}, outro app ${pct(oa.theirs_mape)} (${oa.n} refeição${oa.n === 1 ? '' : 'ões'}). A verdade vem dos gramas da balança e da tabela de nutrientes; o valor do outro app nunca é usado como verdade.`)))
          : h('p', { class: 'muted', id: 'acc-other' }, 'Nenhuma conferência com as calorias de outro app ainda (campo opcional em "Conferir com balança").'));
    }
    show(back(), h('h1', {}, 'Precisão'),
      h('p', { class: 'muted' }, 'Só as conferências com balança medem o erro de verdade. Cada estimativa foi feita antes de você pesar, então o erro vale como teste. O intervalo de 95% sorteia dias de captura, como o motor de avaliação do projeto.'),
      errorBox(problem ? [problem] : []), body,
      h('div', { class: 'stack', style: 'margin-top:12px' }, h('button', { id: 'export-checks', disabled: !checks.length, onclick: doExport }, 'Exportar conferências (compartilhar ou baixar)')), msg,
      h('p', { class: 'muted' }, `Formato ${cal.CHECK_SCHEMA_ID}: as conferências e o manifesto e as previsões prontos para o motor de avaliação.`));
  }
  return { screenAccuracy };
}
