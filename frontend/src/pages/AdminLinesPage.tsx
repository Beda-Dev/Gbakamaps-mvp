// =============================================================================
// Administration des lignes — CRUD complet (créer, modifier, désactiver/
// réactiver, supprimer), demandé explicitement (PROJECT_MEMORY.md §12.16,
// §12.21) sur le modèle direct du CRUD arrêts déjà livré (§12.15).
//
// Backend : POST/PATCH/DELETE /api/admin/lines(/:id), réservé au rôle ADMIN
// (lines.routes.ts) — voir aussi GET /admin/lines/:id/impact, consulté ici
// AVANT toute suppression DURE pour ne jamais présenter un "êtes-vous sûr ?"
// aveugle (une ligne peut desservir des dizaines d'arrêts, détruits en
// cascade). La DÉSACTIVATION (`active: false`) est l'action recommandée en
// priorité : elle retire la ligne du planificateur et de la liste publique
// SANS détruire ses dessertes, réversible en un clic.
// =============================================================================
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useAdminLines,
  useCreateLine,
  useDeleteLine,
  useLineDeletionImpact,
  useUpdateLine,
  type AdminLine,
  type CreateLineInput,
} from '@/hooks/useAdminLines';
import { LoaderIcon, PlusIcon, XIcon } from '@/components/icons';
import type { TransportType } from '@/lib/api/types';

// Même jargon ivoirien que le reste de l'app (StopsMap.tsx STOP_TYPE_LABELS,
// décision produit du 2026-09-06 : termes locaux plutôt qu'une traduction
// littérale de l'anglais GTFS).
const TRANSPORT_TYPE_LABELS: Record<TransportType, string> = {
  BUS: 'Bus (SOTRA)',
  GBAKA: 'Gbaka',
  WORO_WORO: 'Wôrô-wôrô',
  TAXI: 'Taxi',
  MOTO_TAXI: 'Moto-taxi',
};
const TRANSPORT_TYPE_OPTIONS = Object.keys(TRANSPORT_TYPE_LABELS) as TransportType[];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface LineFormState {
  name: string;
  shortName: string;
  color: string;
  transportType: TransportType;
  operator: string;
}

const EMPTY_FORM: LineFormState = { name: '', shortName: '', color: '', transportType: 'BUS', operator: '' };

function lineToFormState(line: AdminLine): LineFormState {
  return {
    name: line.name,
    shortName: line.shortName ?? '',
    color: line.color ?? '',
    transportType: line.transportType,
    operator: line.operator ?? '',
  };
}

// Formulaire minimal partagé création/édition — un seul composant pour ne
// jamais désynchroniser les deux champs de saisie (même choix que
// StopFieldsForm dans AdminStopsPage.tsx).
function LineFieldsForm({
  form,
  onChange,
  colorError,
}: {
  form: LineFormState;
  onChange: (form: LineFormState) => void;
  colorError: boolean;
}) {
  return (
    <>
      <label className="admin-lines__field">
        Nom
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Ex : Aéroport ↔ Gare Sud"
          maxLength={200}
          required
        />
      </label>
      <label className="admin-lines__field">
        Numéro / nom court
        <input
          type="text"
          value={form.shortName}
          onChange={(e) => onChange({ ...form, shortName: e.target.value })}
          placeholder="Ex : 06 (facultatif)"
          maxLength={20}
        />
      </label>
      <label className="admin-lines__field">
        Type de transport
        <select
          value={form.transportType}
          onChange={(e) => onChange({ ...form, transportType: e.target.value as TransportType })}
        >
          {TRANSPORT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {TRANSPORT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-lines__field">
        Opérateur
        <input
          type="text"
          value={form.operator}
          onChange={(e) => onChange({ ...form, operator: e.target.value })}
          placeholder="Ex : SOTRA (facultatif)"
          maxLength={200}
        />
      </label>
      <label className="admin-lines__field">
        Couleur (optionnelle)
        <input
          type="text"
          value={form.color}
          onChange={(e) => onChange({ ...form, color: e.target.value })}
          placeholder="#0A9396"
          maxLength={7}
        />
        {colorError && (
          <span className="admin-lines__field-error">Format attendu : #RRGGBB</span>
        )}
      </label>
    </>
  );
}

export function AdminLinesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<LineFormState>(EMPTY_FORM);
  const [editingLine, setEditingLine] = useState<AdminLine | null>(null);
  const [editForm, setEditForm] = useState<LineFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminLine | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const lines = useAdminLines(query);
  const createLine = useCreateLine();
  const updateLine = useUpdateLine();
  const deleteLine = useDeleteLine();
  const deletionImpact = useLineDeletionImpact();

  const isAdmin = user?.role === 'ADMIN';

  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  if (!authLoading && user && !isAdmin) {
    return (
      <main className="admin-lines">
        <div className="admin-lines__forbidden">
          <h1>Gestion des lignes</h1>
          <p role="alert">Accès réservé aux administrateurs.</p>
          <Link to="/">← Retour à la carte</Link>
        </div>
      </main>
    );
  }

  const loadedLines = lines.data?.lines ?? [];
  const createColorInvalid = createForm.color.trim() !== '' && !HEX_COLOR_RE.test(createForm.color.trim());
  const editColorInvalid = editForm.color.trim() !== '' && !HEX_COLOR_RE.test(editForm.color.trim());

  function formToInput(form: LineFormState): CreateLineInput {
    return {
      name: form.name.trim(),
      shortName: form.shortName.trim() || null,
      color: form.color.trim() || null,
      transportType: form.transportType,
      operator: form.operator.trim() || null,
    };
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (createColorInvalid) return;
    setActionError(null);
    try {
      await createLine.mutateAsync(formToInput(createForm));
      setCreating(false);
      setCreateForm(EMPTY_FORM);
    } catch {
      setActionError('Création impossible. Vérifiez les champs saisis.');
    }
  }

  function startEditing(line: AdminLine) {
    setEditingLine(line);
    setEditForm(lineToFormState(line));
    setActionError(null);
  }

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingLine || editColorInvalid) return;
    try {
      await updateLine.mutateAsync({ id: editingLine.id, input: formToInput(editForm) });
      setEditingLine(null);
    } catch {
      setActionError('Modification impossible.');
    }
  }

  // Désactivation/réactivation — action RÉVERSIBLE recommandée en priorité
  // (cf. en-tête de fichier), jamais bloquée par une confirmation lourde :
  // une ligne réactivée par erreur ne perd aucune donnée.
  async function toggleActive(line: AdminLine) {
    setActionError(null);
    try {
      await updateLine.mutateAsync({ id: line.id, input: { active: !line.active } });
    } catch {
      setActionError(
        line.active ? 'Désactivation impossible.' : 'Réactivation impossible.'
      );
    }
  }

  function openDeleteConfirm(line: AdminLine) {
    setDeleteTarget(line);
    deletionImpact.mutate(line.id);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteLine.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      setActionError('Suppression impossible.');
    }
  }

  return (
    <main className="admin-lines">
      <div className="admin-lines__header">
        <h1>Gestion des lignes</h1>
        <Link to="/">← Retour à la carte</Link>
      </div>

      <div className="admin-lines__controls">
        <input
          type="search"
          className="admin-lines__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une ligne (nom ou numéro)…"
        />
        <button
          type="button"
          className="admin-lines__add-btn"
          onClick={() => {
            setCreating(true);
            setCreateForm(EMPTY_FORM);
          }}
        >
          <PlusIcon width={16} height={16} aria-hidden="true" />
          Nouvelle ligne
        </button>
      </div>

      {actionError && (
        <p className="admin-lines__error" role="alert">
          {actionError}
        </p>
      )}

      {lines.isLoading && (
        <p className="admin-lines__status" role="status">
          <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
          Chargement…
        </p>
      )}

      <ul className="admin-lines__list">
        {loadedLines.map((line) => (
          <li
            key={line.id}
            className={`admin-lines__item${line.active ? '' : ' is-inactive'}`}
          >
            <span
              className="admin-lines__color-dot"
              style={{ backgroundColor: line.color ?? '#0A9396' }}
              aria-hidden="true"
            />
            <div className="admin-lines__item-info">
              <span className="admin-lines__item-name">
                {line.shortName ? `${line.shortName} — ` : ''}
                {line.name}
                {!line.active && <span className="admin-lines__badge">Désactivée</span>}
              </span>
              <span className="admin-lines__item-meta">
                {TRANSPORT_TYPE_LABELS[line.transportType]}
                {line.operator ? ` · ${line.operator}` : ''} · {line._count.stopLines} desserte(s)
                {line.externalRef && ' · import GTFS'}
                {line.shapeSource && ' · tracé officiel connu'}
              </span>
            </div>
            {/* Enveloppe dédiée : sur mobile, permet de passer les 3 actions
                sur leur propre rangée sans toucher au nom de la ligne (voir
                index.css, bug réel trouvé le 2026-09-09 — le nom était
                tronqué "02 — Cité Fairmon…" faute de place à côté des
                boutons). */}
            <div className="admin-lines__item-actions">
              <button type="button" onClick={() => startEditing(line)} aria-label="Modifier">
                Modifier
              </button>
              <button
                type="button"
                className="admin-lines__toggle-btn"
                onClick={() => void toggleActive(line)}
                disabled={updateLine.isPending}
              >
                {line.active ? 'Désactiver' : 'Réactiver'}
              </button>
              <button
                type="button"
                className="admin-lines__delete-btn"
                onClick={() => openDeleteConfirm(line)}
                aria-label="Supprimer définitivement"
                title="Suppression définitive (préférer Désactiver)"
              >
                <XIcon width={14} height={14} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {!lines.isLoading && loadedLines.length === 0 && (
          <li className="admin-lines__empty">Aucune ligne ne correspond à cette recherche.</li>
        )}
      </ul>

      {/* Formulaire de création. */}
      {creating && (
        <div className="admin-lines__dialog-overlay">
          <form className="admin-lines__dialog" onSubmit={(e) => void handleCreate(e)}>
            <h2>Nouvelle ligne</h2>
            <p className="admin-lines__dialog-hint">
              Une ligne créée ici n'a ni référence GTFS ni tracé officiel connu — ce sont des
              informations qui ne peuvent venir que d'un import réel, jamais inventées.
            </p>
            <LineFieldsForm form={createForm} onChange={setCreateForm} colorError={createColorInvalid} />
            <div className="admin-lines__dialog-actions">
              <button type="button" onClick={() => setCreating(false)}>
                Annuler
              </button>
              <button type="submit" disabled={createLine.isPending || !createForm.name.trim()}>
                {createLine.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Formulaire d'édition. */}
      {editingLine && (
        <div className="admin-lines__dialog-overlay">
          <form className="admin-lines__dialog" onSubmit={(e) => void handleSaveEdit(e)}>
            <h2>Modifier la ligne</h2>
            <LineFieldsForm form={editForm} onChange={setEditForm} colorError={editColorInvalid} />
            <div className="admin-lines__dialog-actions">
              <button type="button" onClick={() => setEditingLine(null)}>
                Annuler
              </button>
              <button type="submit" disabled={updateLine.isPending || !editForm.name.trim()}>
                {updateLine.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation de suppression DURE — impact réel affiché avant
          d'agir, jamais un "êtes-vous sûr ?" générique. */}
      {deleteTarget && (
        <div className="admin-lines__dialog-overlay">
          <div className="admin-lines__dialog">
            <h2>Supprimer définitivement « {deleteTarget.name} » ?</h2>
            <p className="admin-lines__dialog-hint">
              Envisagez plutôt « Désactiver » — réversible, sans perte de données.
            </p>
            {deletionImpact.isPending && <p>Calcul de l'impact…</p>}
            {deletionImpact.data && (
              <ul className="admin-lines__impact">
                {deletionImpact.data.stopLinesDeleted > 0 ? (
                  <li>
                    {deletionImpact.data.stopLinesDeleted} desserte(s) d'arrêt seront supprimées
                    définitivement.
                  </li>
                ) : (
                  <li>Aucune desserte liée — suppression sans impact sur le planificateur.</li>
                )}
              </ul>
            )}
            <div className="admin-lines__dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="admin-lines__delete-confirm"
                onClick={() => void confirmDelete()}
                disabled={deleteLine.isPending || deletionImpact.isPending}
              >
                {deleteLine.isPending ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
