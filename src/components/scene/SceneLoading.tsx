import styles from "../hud/hud.module.css";

export function SceneLoading({ title }: { title: string }) {
  return (
    <div className={styles.sceneRoot} style={{ display: "grid", placeItems: "center" }}>
      <p className="mono" style={{ color: "var(--bone-dim)" }}>Loading {title}…</p>
    </div>
  );
}
