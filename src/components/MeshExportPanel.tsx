import React, { useState } from 'react';
import { Download, SlidersHorizontal, CheckSquare, Square, FileArchive, Check } from 'lucide-react';

interface MeshExportPanelProps {
  currentUid: string | null;
  onExportDownload: (fileType: string, targetFaces: number) => void;
  isExporting: boolean;
}

export const MeshExportPanel: React.FC<MeshExportPanelProps> = ({
  currentUid,
  onExportDownload,
  isExporting,
}) => {
  const [fileType, setFileType] = useState<'glb' | 'obj' | 'ply' | 'stl'>('glb');
  const [simplifyMesh, setSimplifyMesh] = useState(false);
  const [targetFaces, setTargetFaces] = useState(15000);
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    onExportDownload(fileType, simplifyMesh ? targetFaces : 40000);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <FileArchive className="w-3.5 h-3.5 text-cyan-400" />
          <span>Transform & Mesh Export</span>
        </h3>
        <span className="text-[10px] text-slate-500 font-mono">FastRemover + Decimate</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Format Selector */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Target Mesh Format</label>
          <div className="grid grid-cols-4 gap-1.5">
            {(['glb', 'obj', 'ply', 'stl'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setFileType(fmt)}
                className={`py-1.5 rounded text-xs font-semibold uppercase transition-colors ${
                  fileType === fmt
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Simplify Checkbox */}
        <div className="flex flex-col justify-end">
          <label
            onClick={() => setSimplifyMesh(!simplifyMesh)}
            className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none pb-2"
          >
            {simplifyMesh ? (
              <CheckSquare className="w-4 h-4 text-cyan-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-500" />
            )}
            <span>Decimate / Simplify Mesh</span>
          </label>
        </div>
      </div>

      {/* Target Face Slider */}
      {simplifyMesh && (
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div className="flex justify-between text-xs text-slate-300 mb-1">
            <span className="flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3 text-cyan-400" />
              <span>Target Polygon Count</span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">
              {targetFaces.toLocaleString()} faces
            </span>
          </div>
          <input
            type="range"
            min="1000"
            max="100000"
            step="1000"
            value={targetFaces}
            onChange={(e) => setTargetFaces(parseInt(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>1,000 (Low Poly)</span>
            <span>100,000 (High Detail)</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex-1 py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-50 cursor-pointer"
        >
          {exported ? (
            <>
              <Check className="w-4 h-4 text-emerald-300" />
              <span>Export Ready!</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Export {fileType.toUpperCase()} ({simplifyMesh ? `${(targetFaces / 1000).toFixed(0)}k faces` : 'Full Res'})</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
