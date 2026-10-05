/**
 * Subiekt Fiscalization Connection Config (#3192-fiscalization)
 *
 * Deliberately a SEPARATE type from `SubiektConnectionConfig` rather than an
 * edit to it — this capability was built in an isolated worktree in parallel
 * with ProductMaster / InventoryMaster / OrderSource work touching the same
 * shared file. Integration (folding this shape into `SubiektConnectionConfig`,
 * updating the config-shape validator + FE form) is the parent branch's job at
 * merge time, per the fork's own directive.
 *
 * @module libs/integrations/subiekt/src/domain/types
 */
export interface SubiektFiscalizationConnectionConfig {
  /**
   * `uf_Konfiguracja.uko_Id` — the physical fiscal-printer this connection
   * registers documents on. REQUIRED for fiscalization to mean anything:
   * `SuDokument.RejestrujNaUF` has no effect without a target device
   * (Pomoc/gta.chm `SuDokument_DrukarkaFiskalnaId.htm`).
   */
  drukarkaFiskalnaId: number;

  /** `dks_Kasa.ks_Id` — optional Stanowisko Kasowe, mirrors the invoicing capability's `defaultStanowiskoKasoweId`. */
  stanowiskoKasoweId?: number;
}
