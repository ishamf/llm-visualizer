import { Navigate, Route, Routes } from 'react-router-dom';

import { HomePage } from './pages/HomePage.tsx';
import { VisualizationPage } from './pages/VisualizationPage.tsx';
import './App.css';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/visualizations/:visualizationId/:datasetId"
        element={<VisualizationPage />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
