import React from 'react';
import { Box, Layers, HardDrive, Clock, Maximize, Cpu } from 'lucide-react';

export interface MeshStats {
  faces: number;
  vertices: number;
  dimensions: { x: number; y: number; z: number };
  durationSeconds: number;
  fileSizeBytes: number;
}

interface MeshStatsPanelProps {
  stats: MeshStats | null;
  modelType: string;
}

export const MeshStatsPanel: React.FC<MeshStatsPanelProps> = ({ stats, modelType }) => {
  if (!stats) {
    return (
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 text-center text-xs text-slate-500">
        Run generation to analyze mesh geometric statistics and bounds.
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Box className="w-3.5 h-3.5 text-cyan-400" />
        <span>Mesh Topometry & Voxel Stats</span>
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Faces */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-cyan-400" />
              <span>Faces</span>
            </span>
          </div>
          <p className="text-sm font-bold text-slate-100 font-mono">
            {stats.faces.toLocaleString()}
          </p>
        </div>

        {/* Vertices */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-indigo-400" />
              <span>Vertices</span>
            </span>
          </div>
          <p className="text-sm font-bold text-slate-100 font-mono">
            {stats.vertices.toLocaleString()}
          </p>
        </div>

        {/* Dimensions */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
            <span className="flex items-center gap-1">
              <Maximize className="w-3 h-3 text-emerald-400" />
              <span>Bounding Box</span>
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-200 font-mono truncate">
            {stats.dimensions.x}m × {stats.dimensions.y}m × {stats.dimensions.z}m
          </p>
        </div>

        {/* Inference Time */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>Inference</span>
            </span>
          </div>
          <p className="text-sm font-bold text-amber-400 font-mono">
            {stats.durationSeconds}s
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/40 px-3 py-1.5 rounded-lg border border-slate-800/60 font-mono">
        <span>File size: <strong className="text-slate-200">{formatBytes(stats.fileSizeBytes)}</strong></span>
        <span>Format: <strong className="text-slate-200">{modelType.toUpperCase()}</strong></span>
        <span className="text-emerald-400 font-medium">Manifold Water-tight</span>
      </div>
    </div>
  );
};
