import styles from "./page.module.scss";
import PDFEditorThird from "@/features/third";

export default function Home() {
  return (
    <div className={styles.page}>
     <PDFEditorThird />
    </div>
  );
}
