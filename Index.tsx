import { Helmet } from "react-helmet";
import LiquidGlassDocViewer from "@/components/LiquidGlassDocViewer";

const Index = () => {
  return (
    <>
      <Helmet>
        <title>Hakimlik Sınavı Çalışma Aracı - DOCX Görüntüleyici</title>
        <meta name="description" content="Hakimlik sınavı için DOCX belgelerini görüntüle, önemli cümleleri işaretle ve çalış." />
      </Helmet>
      <LiquidGlassDocViewer />
    </>
  );
};

export default Index;
