// =============================================================================
// Administration des arrêts — CRUD complet (créer, modifier, déplacer,
// supprimer), confirmé deux fois par l'utilisateur (PROJECT_MEMORY.md
// §12.8/§12.15) + déplacement par glisser-déposer, simple ou multiple,
// demande explicite ultérieure de l'utilisateur.
//
// Backend : POST/PATCH/DELETE /api/admin/stops(/:id), réservé au rôle ADMIN
// (stops.routes.ts) — voir aussi GET /admin/stops/:id/impact, consulté ici
// AVANT toute suppression pour ne jamais présenter un "êtes-vous sûr ?"
// aveugle (favoris/dessertes détruits en cascade, signalements détachés
// mais conservés — deux réalités différentes, annoncées séparément).
// =============================================================================
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useAdminNearbyStops,
  useCreateStop,
  useDeleteStop,
  useStopDeletionImpact,
  useUpdateStop,
  type CreateStopInput,
} from '@/hooks/useAdminStops';
import { AdminStopsMap } from '@/components/AdminStopsMap';
import { StopSearchBar } from '@/components/StopSearchBar';
import { STOP_TYPE_LABELS } from '@/components/StopsMap';
import { LoaderIcon, PlusIcon, XIcon } from '@/components/icons';
import type { Stop } from '@/lib/api/types';

const DEFAULT_CENTER = { lat: 5.32, lon: -4.02 };
const RADIUS_OPTIONS = [500, 1000, 2000, 5000] as const;

const STOP_TYPE_OPTIONS = Object.keys(STOP_TYPE_LABELS) as (keyof typeof STOP_TYPE_LABELS)[];

// Formulaire minimal partagé création/édition — un seul composant pour ne
// jamais désynchroniser les deux champs de saisie.
function StopFieldsForm({
  name,
  stopType,
  onChangeName,
  onChangeType,
}: {
  name: string;
  stopType: string;
  onChangeName: (v: string) => void;
  onChangeType: (v: string) => void;
}) {
  return (
    <>
      <label className="admin-stops__field">
        Nom
        <input
          type="text"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Laisser vide si inconnu"
          maxLength={200}
        />
      </label>
      <label className="admin-stops__field">
        Type
        <select value={stopType} onChange={(e) => onChangeType(e.target.value)}>
          {STOP_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {STOP_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function AdminStopsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [radius, setRadius] = useState<number>(1000);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addMode, setAddMode] = useState(false);
  const [pendingNewPoint, setPendingNewPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<string>('BUS_STOP');
  const [editingStop, setEditingStop] = useState<Stop | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('BUS_STOP');
  const [deleteTarget, setDeleteTarget] = useState<Stop | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const stops = useAdminNearbyStops(center.lat, center.lon, radius);
  const createStop = useCreateStop();
  const updateStop = useUpdateStop();
  const deleteStop = useDeleteStop();
  const deletionImpact = useStopDeletionImpact();

  const isAdmin = user?.role === 'ADMIN';

  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  if (!authLoading && user && !isAdmin) {
    return (
      <main className="admin-stops">
        <div className="admin-stops__forbidden">
          <h1>Gestion des arrêts</h1>
          <p role="alert">Accès réservé aux administrateurs.</p>
          <Link to="/">← Retour à la carte</Link>
        </div>
      </main>
    );
  }

  const loadedStops = stops.data?.stops ?? [];

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new globalThis.Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMapClick(point: { lat: number; lon: number }) {
    if (!addMode) return;
    setPendingNewPoint(point);
  }

  async function handleCreateStop(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingNewPoint) return;
    setActionError(null);
    const input: CreateStopInput = {
      name: newName.trim() || null,
      lat: pendingNewPoint.lat,
      lon: pendingNewPoint.lon,
      stopType: newType,
    };
    try {
      await createStop.mutateAsync(input);
      setPendingNewPoint(null);
      setNewName('');
      setAddMode(false);
    } catch {
      setActionError("Création impossible. Vérifiez que le point est dans la zone de service.");
    }
  }

  function startEditing(stop: Stop) {
    setEditingStop(stop);
    setEditName(stop.name ?? '');
    setEditType(stop.stopType);
    setActionError(null);
  }

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingStop) return;
    try {
      await updateStop.mutateAsync({
        id: editingStop.id,
        input: { name: editName.trim() || null, stopType: editType },
      });
      setEditingStop(null);
    } catch {
      setActionError('Modification impossible.');
    }
  }

  // Un déplacement (simple ou groupé, voir AdminStopsMap) déclenche une
  // mutation PATCH par arrêt déplacé — pas de nouvel endpoint de lot côté
  // backend : le volume typique d'un glisser-déposer (quelques arrêts) ne
  // justifie pas la surface supplémentaire.
  function handleMoveStops(moves: { id: string; lat: number; lon: number }[]) {
    setActionError(null);
    for (const move of moves) {
      updateStop.mutate(
        { id: move.id, input: { lat: move.lat, lon: move.lon } },
        { onError: () => setActionError("Le déplacement d'au moins un arrêt n'a pas pu être enregistré.") }
      );
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteStop.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedIds((prev) => {
        const next = new globalThis.Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
    } catch {
      setActionError('Suppression impossible.');
    }
  }

  function openDeleteConfirm(stop: Stop) {
    setDeleteTarget(stop);
    deletionImpact.mutate(stop.id);
  }

  // Désactivation/réactivation — action RÉVERSIBLE recommandée en priorité
  // sur la suppression dure (cohérence avec TransportLine.active, §12.22) :
  // un arrêt réactivé par erreur ne perd aucune donnée.
  async function toggleActive(stop: Stop) {
    setActionError(null);
    try {
      await updateStop.mutateAsync({ id: stop.id, input: { active: !(stop.active ?? true) } });
    } catch {
      setActionError(stop.active === false ? 'Réactivation impossible.' : 'Désactivation impossible.');
    }
  }

  return (
    <main className="admin-stops">
      <div className="admin-stops__sidebar">
        <div className="admin-stops__header">
          <h1>Gestion des arrêts</h1>
          <Link to="/">← Retour à la carte</Link>
        </div>

        <StopSearchBar
          near={center}
          onSelectStop={(stop) => setCenter({ lat: stop.lat, lon: stop.lon })}
        />

        <div className="admin-stops__controls">
          <label>
            Rayon affiché
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`admin-stops__add-btn${addMode ? ' is-active' : ''}`}
            onClick={() => {
              setAddMode((v) => !v);
              setPendingNewPoint(null);
            }}
          >
            <PlusIcon width={16} height={16} aria-hidden="true" />
            {addMode ? 'Cliquez sur la carte…' : 'Ajouter un arrêt'}
          </button>
        </div>

        {selectedIds.size > 1 && (
          <p className="admin-stops__hint" role="status">
            {selectedIds.size} arrêts sélectionnés — glisser l'un d'eux les déplace tous ensemble.
          </p>
        )}

        {actionError && (
          <p className="admin-stops__error" role="alert">
            {actionError}
          </p>
        )}

        {stops.isLoading && (
          <p className="admin-stops__status" role="status">
            <LoaderIcon className="icon-spin" width={16} height={16} aria-hidden="true" />
            Chargement…
          </p>
        )}

        <ul className="admin-stops__list">
          {loadedStops.map((stop) => (
            <li
              key={stop.id}
              className={`admin-stops__item${stop.active === false ? ' is-inactive' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(stop.id)}
                onChange={() => toggleSelected(stop.id)}
                aria-label={`Sélectionner ${stop.name ?? 'arrêt sans nom'}`}
              />
              <div className="admin-stops__item-info">
                <span className="admin-stops__item-name">
                  {stop.name ?? 'Arrêt sans nom'}
                  {stop.active === false && <span className="admin-stops__badge">Désactivé</span>}
                </span>
                <span className="admin-stops__item-type">{STOP_TYPE_LABELS[stop.stopType] ?? stop.stopType}</span>
              </div>
              <button type="button" onClick={() => startEditing(stop)} aria-label="Modifier">
                Modifier
              </button>
              <button
                type="button"
                className="admin-stops__toggle-btn"
                onClick={() => void toggleActive(stop)}
                disabled={updateStop.isPending}
              >
                {stop.active === false ? 'Réactiver' : 'Désactiver'}
              </button>
              <button
                type="button"
                className="admin-stops__delete-btn"
                onClick={() => openDeleteConfirm(stop)}
                aria-label="Supprimer"
              >
                <XIcon width={14} height={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="admin-stops__map">
        <AdminStopsMap
          center={center}
          stops={loadedStops}
          selectedIds={selectedIds}
          pendingNewPoint={pendingNewPoint}
          onMapClick={handleMapClick}
          onMoveStops={handleMoveStops}
        />
      </div>

      {/* Formulaire de création — point posé sur la carte en mode "ajouter". */}
      {pendingNewPoint && (
        <div className="admin-stops__dialog-overlay">
          <form className="admin-stops__dialog" onSubmit={(e) => void handleCreateStop(e)}>
            <h2>Nouvel arrêt</h2>
            <StopFieldsForm
              name={newName}
              stopType={newType}
              onChangeName={setNewName}
              onChangeType={setNewType}
            />
            <div className="admin-stops__dialog-actions">
              <button type="button" onClick={() => setPendingNewPoint(null)}>
                Annuler
              </button>
              <button type="submit" disabled={createStop.isPending}>
                {createStop.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Formulaire d'édition. */}
      {editingStop && (
        <div className="admin-stops__dialog-overlay">
          <form className="admin-stops__dialog" onSubmit={(e) => void handleSaveEdit(e)}>
            <h2>Modifier l'arrêt</h2>
            <StopFieldsForm
              name={editName}
              stopType={editType}
              onChangeName={setEditName}
              onChangeType={setEditType}
            />
            <div className="admin-stops__dialog-actions">
              <button type="button" onClick={() => setEditingStop(null)}>
                Annuler
              </button>
              <button type="submit" disabled={updateStop.isPending}>
                {updateStop.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation de suppression — impact réel affiché avant d'agir,
          jamais un "êtes-vous sûr ?" générique (garde-fou explicite). */}
      {deleteTarget && (
        <div className="admin-stops__dialog-overlay">
          <div className="admin-stops__dialog">
            <h2>Supprimer « {deleteTarget.name ?? 'cet arrêt'} » ?</h2>
            {deletionImpact.isPending && <p>Calcul de l'impact…</p>}
            {deletionImpact.data && (
              <ul className="admin-stops__impact">
                {deletionImpact.data.favoritesDeleted > 0 && (
                  <li>{deletionImpact.data.favoritesDeleted} favori(s) seront supprimés.</li>
                )}
                {deletionImpact.data.stopLinesDeleted > 0 && (
                  <li>{deletionImpact.data.stopLinesDeleted} desserte(s) de ligne seront supprimées.</li>
                )}
                {deletionImpact.data.reportsDetached > 0 && (
                  <li>
                    {deletionImpact.data.reportsDetached} signalement(s) resteront mais seront détachés de
                    cet arrêt.
                  </li>
                )}
                {deletionImpact.data.favoritesDeleted === 0 &&
                  deletionImpact.data.stopLinesDeleted === 0 &&
                  deletionImpact.data.reportsDetached === 0 && <li>Aucune donnée liée trouvée.</li>}
              </ul>
            )}
            <div className="admin-stops__dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="admin-stops__delete-confirm"
                onClick={() => void confirmDelete()}
                disabled={deleteStop.isPending || deletionImpact.isPending}
              >
                {deleteStop.isPending ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
