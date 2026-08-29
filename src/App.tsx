import { Navigate, Route, Routes } from 'react-router-dom';

import { DevVisualizationSelectorPage } from './pages/DevVisualizationSelectorPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { VisualizationPage } from './pages/VisualizationPage.tsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/generate" element={<Navigate to="/" replace />} />
      <Route
        path="/dev/visualizations"
        element={
          import.meta.env.DEV ? (
            <DevVisualizationSelectorPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/visualizations/:visualizationId/:datasetId"
        element={<VisualizationPage />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
