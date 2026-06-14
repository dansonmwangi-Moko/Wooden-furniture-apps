import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Minus, 
  Search, 
  FileDown, 
  FileUp, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  Calendar, 
  User, 
  MapPin, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Check, 
  FileSpreadsheet, 
  History, 
  ClipboardCheck, 
  Sparkles,
  Layers,
  HelpCircle,
  ArrowRight
} from "lucide-react";
import { RAW_MATERIALS, RawMaterial } from "./rawMaterials";
import { motion, AnimatePresence } from "motion/react";

interface Submission {
  id: string;
  timestamp: string;
  clerkName: string;
  dateOfCount: string;
  locationId: string;
  items: {
    partNumber: string;
    description: string;
    category: string;
    uom: string;
    count: number;
  }[];
  totalItemsCounted: number;
  totalQuantity: number;
}

interface CSVPreviewRow {
  rowIndex: number;
  partNumber: string;
  originalPartNumber: string;
  parsedQty: string;
  uom: string;
  category: string;
  description: string;
  isValid: boolean;
  warning?: string;
  isIntegerIssue?: boolean;
}

const WAREHOUSE_LOCATIONS = [
  "Machining",
  "Joinery",
  "Filling and sanding",
  "Spraying",
  "Wrapping",
  "Sofa sewing",
  "Sofa webbing",
  "Sofa foaming",
  "Sofa fitting",
  "Sofa finishing"
];

export default function App() {
  // --- Header metadata state ---
  const [clerkName, setClerkName] = useState<string>(() => {
    return localStorage.getItem("batch_clerk_name") || "";
  });
  const [dateOfCount, setDateOfCount] = useState<string>(() => {
    return localStorage.getItem("batch_date_of_count") || new Date().toISOString().split('T')[0];
  });
  const [locationId, setLocationId] = useState<string>(() => {
    return localStorage.getItem("batch_location_id") || "";
  });

  // --- Counts state (partNumber -> count string/number) ---
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("batch_counts");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return {};
      }
    }
    return {};
  });

  // --- UI Filter & Navigation states ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [completionFilter, setCompletionFilter] = useState<"all" | "counted" | "uncounted">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12; // slightly reduced for clean bento fitting

  // --- UI Notification states ---
  const [autosaveTime, setAutosaveTime] = useState<string | null>(null);
  const [justSavedNotification, setJustSavedNotification] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // --- Modals and Import panels ---
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importStatus, setImportStatus] = useState<{
    success: boolean;
    message: string;
    addedCount?: number;
    errors?: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Submitted History state ---
  const [submissions, setSubmissions] = useState<Submission[]>(() => {
    try {
      const saved = localStorage.getItem("batch_submissions_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);

  // --- UPGRADES STATE: Interactive training walkthrough ---
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    return localStorage.getItem("batch_hide_tutorial") !== "true";
  });
  const [tutorialStep, setTutorialStep] = useState<number>(0);

  // --- UPGRADES STATE: CSV Sandbox Preview ---
  const [csvPreviewRows, setCsvPreviewRows] = useState<CSVPreviewRow[] | null>(null);

  // --- Dynamic Input References object for Arrow-key & Enter focus shifts ---
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // --- Extract categories for filters ---
  const categories = useMemo(() => {
    const cats = new Set(RAW_MATERIALS.map(r => r.category));
    return ["All", ...Array.from(cats).sort()];
  }, []);

  // --- Real-Time Statistics per category (Bento Audit Map) ---
  const categoryStats = useMemo(() => {
    return categories.filter(c => c !== "All").map(cat => {
      const items = RAW_MATERIALS.filter(m => m.category === cat);
      const totalCount = items.length;
      const countedCount = items.filter(m => {
        const val = counts[m.partNumber];
        return val !== undefined && val !== "" && !isNaN(Number(val)) && Number(val) >= 0;
      }).length;
      const pct = totalCount > 0 ? Math.round((countedCount / totalCount) * 100) : 0;
      return {
        category: cat,
        total: totalCount,
        counted: countedCount,
        percentage: pct,
        isCompleted: countedCount === totalCount && totalCount > 0
      };
    });
  }, [counts, categories]);

  // --- Total statistics ---
  const totalMaterials = RAW_MATERIALS.length;
  
  const completedCount = useMemo(() => {
    return RAW_MATERIALS.filter(item => {
      const val = counts[item.partNumber];
      return val !== undefined && val !== "" && !isNaN(Number(val)) && Number(val) >= 0;
    }).length;
  }, [counts]);

  const completionPercentage = useMemo(() => {
    if (totalMaterials === 0) return 0;
    return Math.round((completedCount / totalMaterials) * 100);
  }, [completedCount, totalMaterials]);

  // --- Real-time validation for specific row entries ---
  const validationErrors = useMemo<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    Object.entries(counts).forEach(([partNum, rawVal]) => {
      if (rawVal === "") return;
      const val = Number(rawVal);
      if (isNaN(val)) {
        errors[partNum] = "Must be a valid number";
      } else if (val < 0) {
        errors[partNum] = "Physical count cannot be negative";
      } else if (!Number.isInteger(val) && (partNum.includes("PCS") || partNum.includes("PC") || partNum.includes("PKTS"))) {
        // Warning if user inputs fraction for pieces/packets
        errors[partNum] = "Units normally require whole numbers (integers)";
      }
    });
    return errors;
  }, [counts]);

  // --- Save states to localStorage with debouncing for latency-free typing performance ---
  useEffect(() => {
    let notifyTimer: any;
    const timer = setTimeout(() => {
      localStorage.setItem("batch_clerk_name", clerkName);
      localStorage.setItem("batch_date_of_count", dateOfCount);
      localStorage.setItem("batch_location_id", locationId);
      localStorage.setItem("batch_counts", JSON.stringify(counts));

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setAutosaveTime(timeStr);
      
      // Briefly animate an autosave success indicator
      setJustSavedNotification(true);
      notifyTimer = setTimeout(() => setJustSavedNotification(false), 1500);
    }, 600);

    return () => {
      clearTimeout(timer);
      if (notifyTimer) clearTimeout(notifyTimer);
    };
  }, [clerkName, dateOfCount, locationId, counts]);

  // --- History persistence ---
  useEffect(() => {
    localStorage.setItem("batch_submissions_history", JSON.stringify(submissions));
  }, [submissions]);

  // --- Hide tutorial switch persistence ---
  useEffect(() => {
    localStorage.setItem("batch_hide_tutorial", showTutorial ? "false" : "true");
  }, [showTutorial]);

  // --- Reset page helper when filters change ---
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, completionFilter]);

  // --- Keyboard handlers & count helpers ---
  const updateCountState = (partNumber: string, newValueStr: string) => {
    setCounts(prev => ({
      ...prev,
      [partNumber]: newValueStr
    }));
  };

  const adjustCountBy = (partNumber: string, delta: number) => {
    const currentRaw = counts[partNumber];
    const currentVal = (currentRaw === undefined || currentRaw === "" || isNaN(Number(currentRaw))) ? 0 : Number(currentRaw);
    const newVal = Math.max(0, currentVal + delta);
    updateCountState(partNumber, newVal.toString());
  };

  // --- Keyboard Grid Navigation logic ---
  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    partNumber: string,
    visibleMaterials: { partNumber: string }[]
  ) => {
    const currentIndex = visibleMaterials.findIndex(m => m.partNumber === partNumber);
    
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (currentIndex !== -1 && currentIndex < visibleMaterials.length - 1) {
        const nextPartNumber = visibleMaterials[currentIndex + 1].partNumber;
        const targetInput = inputRefs.current[nextPartNumber];
        if (targetInput) {
          targetInput.focus();
          targetInput.select();
        }
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentIndex > 0) {
        const prevPartNumber = visibleMaterials[currentIndex - 1].partNumber;
        const targetInput = inputRefs.current[prevPartNumber];
        if (targetInput) {
          targetInput.focus();
          targetInput.select();
        }
      }
    }
  };



  // --- Filtered and Searched Raw Materials ---
  const filteredMaterials = useMemo(() => {
    return RAW_MATERIALS.filter(item => {
      // 1. Search Query
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        item.partNumber.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query);

      // 2. Category Filter
      const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;

      // 3. Completion Filter
      const hasCount = counts[item.partNumber] !== undefined && counts[item.partNumber] !== "";
      const matchesCompletion = 
        completionFilter === "all" ||
        (completionFilter === "counted" && hasCount) ||
        (completionFilter === "uncounted" && !hasCount);

      return matchesSearch && matchesCategory && matchesCompletion;
    });
  }, [searchQuery, selectedCategory, completionFilter, counts]);

  // --- Paginated materials ---
  const totalFilteredCount = filteredMaterials.length;
  const totalPages = Math.ceil(totalFilteredCount / itemsPerPage) || 1;
  
  const paginatedMaterials = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredMaterials.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredMaterials, currentPage]);

  const activePageMaterialsWithCounts = useMemo(() => {
    return paginatedMaterials.map(mat => ({
      ...mat,
      currentVal: counts[mat.partNumber] || "",
      error: validationErrors[mat.partNumber]
    }));
  }, [paginatedMaterials, counts, validationErrors]);

  // --- Action Handlers ---
  const handleClearAllCounts = () => {
    if (window.confirm("Are you absolutely sure you want to clear all current progress? This action cannot be undone.")) {
      setCounts({});
      setSearchQuery("");
      setSelectedCategory("All");
      setCompletionFilter("all");
      setCurrentPage(1);
    }
  };

  // --- Generate CSV Template ---
  const handleDownloadTemplate = () => {
    const headers = ["Part number", "Raw material description", "Category", "UoM", "Suggested Count (Insert Counts Here)"];
    const rows = RAW_MATERIALS.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      m.category,
      m.uom,
      ""
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    triggerDownload(csvContent, `RM_Physical_Count_Template.csv`);
  };

  // --- Export Draft Counts CSV ---
  const handleExportDraft = () => {
    const headers = ["Part number", "Raw material description", "Category", "UoM", "Counted Progress"];
    const rows = RAW_MATERIALS.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      m.category,
      m.uom,
      counts[m.partNumber] || ""
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    triggerDownload(csvContent, `Draft_RM_Count_${locationId || "unspecified"}_${dateOfCount}.csv`);
  };

  // --- Trigger CSV File Download helper ---
  const triggerDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Sandbox Parser Phase 1: parse uploaded or pasted CSV ---
  const handleSandboxCsvParse = (textToParse: string) => {
    if (!textToParse.trim()) {
      setImportStatus({ success: false, message: "Please paste or drag a CSV file first." });
      return;
    }

    try {
      const lines = textToParse.split(/\r?\n/);
      if (lines.length < 2) {
        setImportStatus({ success: false, message: "No rows or header line detected in data." });
        return;
      }

      const previewRowsList: CSVPreviewRow[] = [];
      const errorsList: string[] = [];
      
      // smart find indexes
      const firstLine = lines[0].toLowerCase();
      const headers = firstLine.split(",").map(h => h.trim().replace(/^["']|["']$/g, ""));
      
      let partNumberColIndex = headers.findIndex(h => h.includes("part") || h.includes("number") || h.includes("rm-") || h.includes("sku"));
      let countColIndex = headers.findIndex(h => h.includes("count") || h.includes("qty") || h.includes("quantity") || h.includes("physical") || h.includes("insert") || h.includes("progress"));

      if (partNumberColIndex === -1) partNumberColIndex = 0;
      if (countColIndex === -1) {
        countColIndex = headers.length - 1 >= 4 ? 4 : headers.length - 1;
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // smart quote safe split
        const parts: string[] = [];
        let insideQuote = false;
        let currentPart = "";
        
        for (let charIndex = 0; charIndex < line.length; charIndex++) {
          const char = line[charIndex];
          if (char === '"') {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            parts.push(currentPart.trim().replace(/^["']|["']$/g, ""));
            currentPart = "";
          } else {
            currentPart += char;
          }
        }
        parts.push(currentPart.trim().replace(/^["']|["']$/g, ""));

        if (parts.length <= Math.max(partNumberColIndex, countColIndex)) {
          previewRowsList.push({
            rowIndex: i + 1,
            partNumber: "N/A",
            originalPartNumber: "N/A",
            parsedQty: "N/A",
            uom: "N/A",
            category: "N/A",
            description: "N/A",
            isValid: false,
            warning: "Insufficient spreadsheet column blocks."
          });
          continue;
        }

        const originalSKU = parts[partNumberColIndex] || "";
        const rawSku = originalSKU.trim().toUpperCase();
        const rawQtyStr = parts[countColIndex] || "";

        // Unrecognized check
        const matchedMaterial = RAW_MATERIALS.find(rm => rm.partNumber.toUpperCase() === rawSku);
        if (!matchedMaterial) {
          previewRowsList.push({
            rowIndex: i + 1,
            partNumber: rawSku || "EMPTY",
            originalPartNumber: originalSKU,
            parsedQty: rawQtyStr,
            uom: "N/A",
            category: "N/A",
            description: `SKU "${rawSku}" does not exist in master record roster`,
            isValid: false,
            warning: "SKU Mismatch Error"
          });
          continue;
        }

        if (rawQtyStr.trim() === "") {
          // Ignored skip row
          continue;
        }

        const numericCount = Number(rawQtyStr);
        if (isNaN(numericCount) || numericCount < 0) {
          previewRowsList.push({
            rowIndex: i + 1,
            partNumber: matchedMaterial.partNumber,
            originalPartNumber: originalSKU,
            parsedQty: rawQtyStr,
            uom: matchedMaterial.uom,
            category: matchedMaterial.category,
            description: matchedMaterial.description,
            isValid: false,
            warning: `Could not parse count value "${rawQtyStr}"`
          });
          continue;
        }

        const isWholeUnit = matchedMaterial.partNumber.includes("PCS") || 
                            matchedMaterial.partNumber.includes("PC") || 
                            matchedMaterial.partNumber.includes("PKTS");
        const isDecimalIssue = isWholeUnit && !Number.isInteger(numericCount);

        previewRowsList.push({
          rowIndex: i + 1,
          partNumber: matchedMaterial.partNumber,
          originalPartNumber: originalSKU,
          parsedQty: numericCount.toString(),
          uom: matchedMaterial.uom,
          category: matchedMaterial.category,
          description: matchedMaterial.description,
          isValid: true,
          isIntegerIssue: isDecimalIssue,
          warning: isDecimalIssue ? "Warning: Unit typically requires whole numbers" : undefined
        });
      }

      setCsvPreviewRows(previewRowsList);
      setImportStatus({
        success: true,
        message: `Successfully parsed ${previewRowsList.length} counts for sandboxed verification review.`
      });
    } catch (e: any) {
      setImportStatus({
        success: false,
        message: `Parser Error: ${e.message || e}`
      });
    }
  };

  // --- Sandbox Parser Phase 2: complete final merge into active draft ---
  const handleApproveAndMergeCsv = () => {
    if (!csvPreviewRows) return;

    const finalCounts = { ...counts };
    let successCount = 0;

    csvPreviewRows.forEach(row => {
      if (row.isValid) {
        finalCounts[row.partNumber] = row.parsedQty;
        successCount++;
      }
    });

    setCounts(finalCounts);
    setIsImportModalOpen(false);
    setCsvPreviewRows(null);
    setImportCsvText("");
    setImportStatus(null);

    setSubmitSuccess(`Visual CSV Merged: Successfully wrote physical quantities for ${successCount} SKUs into active draft!`);
  };

  const handleCsvImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSandboxCsvParse(importCsvText);
  };

  // --- Drag and Drop File Handlers ---
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readCsvFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readCsvFile(file);
    }
  };

  const readCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportCsvText(text);
      handleSandboxCsvParse(text);
    };
    reader.onerror = () => {
      setImportStatus({ success: false, message: "Failed to read local uploaded file." });
    };
    reader.readAsText(file);
  };

  // --- Final submission generator ---
  const itemsForSubmission = useMemo(() => {
    return RAW_MATERIALS.map(m => {
      const rawCount = counts[m.partNumber];
      const countNum = (rawCount === undefined || rawCount === "") ? null : Number(rawCount);
      return {
        ...m,
        count: countNum
      };
    }).filter((subItem): subItem is typeof subItem & { count: number } => {
      return subItem.count !== null && !isNaN(subItem.count);
    });
  }, [counts]);

  const hasHeaderValidationErrors = !clerkName.trim() || !locationId.trim() || !dateOfCount;
  const isSubmissionDisabled = itemsForSubmission.length === 0 || hasHeaderValidationErrors || Object.keys(validationErrors).length > 0;

  const handleFinalSubmit = () => {
    if (isSubmissionDisabled) return;

    // Create submitted record
    const totalQty = itemsForSubmission.reduce((acc, curr) => acc + curr.count, 0);
    const newSubmission: Submission = {
      id: `SUB-${Date.now()}`,
      timestamp: new Date().toLocaleString(),
      clerkName: clerkName.trim(),
      dateOfCount,
      locationId: locationId.trim().toUpperCase(),
      items: itemsForSubmission,
      totalItemsCounted: itemsForSubmission.length,
      totalQuantity: totalQty
    };

    setSubmissions(prev => [newSubmission, ...prev]);
    setIsConfirmModalOpen(false);

    // Build downloadable CSV of the submission itself immediately
    const headers = ["Part number", "Raw material description", "Category", "UoM", "Physical Inventory Count"];
    const rows = itemsForSubmission.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      m.category,
      m.uom,
      m.count
    ]);
    
    // Include metadata in header comments or top info space for clean reference
    const metaInfo = [
      `"Data Clerk Name","${clerkName.replace(/"/g, '""')}"`,
      `"Location ID","${locationId.toUpperCase().replace(/"/g, '""')}"`,
      `"Date of Inventory Count","${dateOfCount}"`,
      `"Submitted Timestamp","${newSubmission.timestamp}"`,
      `"Unique Count ID","${newSubmission.id}"`,
      `"Total Parts Counted","${itemsForSubmission.length}"`,
      `"Total Quantity Sum","${totalQty}"`,
      "" // Empty line separating header metadata from rows
    ].join("\n");

    const csvContent = metaInfo + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    triggerDownload(csvContent, `FINAL_Count_Report_${locationId.toUpperCase()}_${dateOfCount}.csv`);

    // Flag success view
    setSubmitSuccess(`Submission report successfully generated and downloaded! Record added to history.`);
    
    // Clear counts state so they can safely start on a new physical counting batch
    setCounts({});
  };

  const downloadHistoricalCsv = (sub: Submission) => {
    const headers = ["Part number", "Raw material description", "Category", "UoM", "Physical Inventory Count"];
    const rows = sub.items.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      m.category,
      m.uom,
      m.count
    ]);
    
    const metaInfo = [
      `"Data Clerk Name","${sub.clerkName}"`,
      `"Location ID","${sub.locationId}"`,
      `"Date of Inventory Count","${sub.dateOfCount}"`,
      `"Submitted Timestamp","${sub.timestamp}"`,
      `"Unique Count ID","${sub.id}"`,
      `"Total Parts Counted","${sub.totalItemsCounted}"`,
      `"Total Quantity Sum","${sub.totalQuantity}"`,
      ""
    ].join("\n");

    const csvContent = metaInfo + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    triggerDownload(csvContent, `Historical_RM_Report_${sub.locationId}_${sub.dateOfCount}.csv`);
  };

  const deleteHistoryRecord = (id: string) => {
    if (window.confirm("Delete this submission record from local history log? (Counts data is already generated and saved in downloaded files)")) {
      setSubmissions(prev => prev.filter(s => s.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans transition-all duration-150">
      
      {/* HEADER BAR */}
      <header id="main-header" className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-xs w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          {/* Standalone Title Space */}
          <div className="flex items-center gap-2.5 sm:gap-3 w-full">
            <div className="p-1.5 sm:p-2.5 bg-slate-900 text-white rounded-xl shadow-xs shrink-0">
              <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
                Raw Material Physical Inventory Count
                <span className="text-[10px] sm:text-xs font-normal bg-amber-500 text-slate-950 px-2 sm:px-2.5 py-0.5 rounded-full font-bold shrink-0">
                  Active Audit Form
                </span>
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-500 font-medium truncate sm:whitespace-normal">
                Standardized stock-counting interface for warehouse sections & production zones
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Non-Sticky Operations Bar */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <div className="text-xs text-slate-500 font-semibold flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-400"></span>
              Department of Operations & Logistical Control
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Auto save heartbeat indicator */}
              <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-800 border border-emerald-100">
                <span className={`h-2 w-2 rounded-full ${justSavedNotification ? 'bg-emerald-600 animate-ping' : 'bg-emerald-500'}`}></span>
                <span>Draft Autosaved {autosaveTime && `at ${autosaveTime}`}</span>
              </div>

              <button
                id="help-guide-toggle-btn"
                onClick={() => setShowTutorial(!showTutorial)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  showTutorial 
                    ? 'bg-amber-100 border-amber-200 text-amber-900' 
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                title="Toggle interactive wizard tutorial"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showTutorial ? "Hide Tutor Instructions" : "Quick Tutor Guide"}</span>
              </button>

              <button
                id="history-toggle-btn"
                onClick={() => setShowHistory(!showHistory)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  showHistory 
                    ? 'bg-slate-900 border-slate-900 text-white' 
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>History Logs ({submissions.length})</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CLERK DRAFT METADATA VALIDATION ALERT */}
      {hasHeaderValidationErrors && (
        <div id="missing-header-top-ribbon" className="bg-amber-500 text-white text-xs font-bold py-2 text-center flex items-center justify-center gap-2 shadow-inner">
          <AlertTriangle className="w-4 h-4" />
          <span>IMPORTANT: Please input Clerk Name, location, and date below. Submission features are temporarily disabled until completed!</span>
        </div>
      )}

      {/* SUBMIT SUCCESS TOAST */}
      {submitSuccess && (
        <div id="submit-success-toast" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 w-full">
          <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-xl shadow-xs flex justify-between items-start">
            <div className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Count Updated!</p>
                <p className="text-xs text-emerald-700 mt-1 font-medium">{submitSuccess}</p>
              </div>
            </div>
            <button 
              onClick={() => setSubmitSuccess(null)}
              className="text-emerald-500 hover:text-emerald-700 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col gap-6">

        {/* WIZARD TRAINING STEP INTERACTIVE OVERLAY */}
        {showTutorial && (
          <div id="wizard-tutorial-panel" className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6 shadow-sm relative overflow-hidden">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500 text-white rounded-xl shadow-sm shrink-0">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>

              <div className="space-y-3 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/50 pb-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-amber-600 uppercase tracking-widest leading-none">Clerk Quick Training Assistant</span>
                    <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold font-mono shrink-0">
                      Step {tutorialStep + 1} of 4
                    </span>
                  </div>
                  <button 
                    onClick={() => setShowTutorial(false)}
                    className="text-amber-500 hover:text-amber-900 text-xs font-bold bg-white/70 px-2.5 py-1 rounded-lg border border-amber-200 transition-all cursor-pointer self-start sm:self-auto shrink-0"
                  >
                    Dismiss Permanently
                  </button>
                </div>

                {tutorialStep === 0 && (
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-900 text-base">Step 1: Set Up Work Tracking Details</h3>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
                      Before auditing items, type your **Clerk Name** and select your **Location Zone** from the dropdown menu in the Org Context card. Valid entries ensure your generated counts are categorized and saved under the right location ID automatically.
                    </p>
                  </div>
                )}

                {tutorialStep === 1 && (
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-900 text-base">Step 2: Category Completion Audit Map</h3>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
                      Use the **Warehouse Categories Audit bento box** below! Click on any category card to instantly filter the list table to those products. Perfect for section-by-section physical audits so you never forget raw material types.
                    </p>
                  </div>
                )}

                {tutorialStep === 2 && (
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-900 text-base">Step 3: Rapid Keyboard Excel-Grid Counting</h3>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
                      Save physical exhaustion! Inside any table row count input, press **ArrowUp/Down** or hit **Enter** on your numpad to immediately focus the cell above or below. Avoid mouse clicking altogether to complete batch listings 10x faster.
                    </p>
                  </div>
                )}

                {tutorialStep === 3 && (
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-900 text-base">Step 4: CSV Spreadsheet Import Sandbox</h3>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
                      Want to load existing stock sheets? Use the **CSV Import Sandbox** to safely parse CSVs, identify unrecognized material SKUs, and view validation warning logs BEFORE applying them to your active count list! Paste or drag files directly.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    disabled={tutorialStep === 0}
                    onClick={() => setTutorialStep(prev => prev - 1)}
                    className="px-3 py-1.5 rounded-lg border border-amber-300 text-slate-700 bg-white hover:bg-slate-50 text-xs font-bold disabled:opacity-45 disabled:cursor-not-allowed transition-all"
                  >
                    Previous Tip
                  </button>
                  <button
                    onClick={() => {
                      if (tutorialStep < 3) {
                        setTutorialStep(prev => prev + 1);
                      } else {
                        setShowTutorial(false);
                      }
                    }}
                    className="px-4.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <span>{tutorialStep === 3 ? "Got It, Close" : "Continue Guide"}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

              </div>
            </div>
          </div>
        )}
        
        {/* LOCAL STORAGE HISTORY DRAWER */}
        {showHistory && (
          <div id="history-section" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs animate-fadeIn">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-4">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 animate-pulse">
                <History className="w-5 h-5 text-slate-500" />
                Submitted Records & Exports history
              </h2>
              <button 
                onClick={() => setShowHistory(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {submissions.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-sm font-medium">No previous raw material counts found in browser history.</p>
                <p className="text-xs mt-1">Ready to create your first submittal report!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[350px] overflow-y-auto pr-2">
                {submissions.map((sub) => (
                  <div key={sub.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 flex flex-col justify-between hover:border-slate-300 transition-colors">
                    <div>
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-xs font-mono bg-slate-200 text-slate-800 px-2 py-0.5 rounded font-bold">
                          {sub.locationId}
                        </span>
                        <span className="text-[11px] text-slate-500">{sub.timestamp}</span>
                      </div>
                      
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold text-slate-500">Clerk:</span> {sub.clerkName}
                        </p>
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold text-slate-500">Count Date:</span> {sub.dateOfCount}
                        </p>
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold text-slate-500">Items:</span> {sub.totalItemsCounted} distinct items
                        </p>
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold text-slate-500">Sum Units:</span> <span className="font-semibold text-slate-900">{sub.totalQuantity}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4 pt-3 border-t border-slate-200/60">
                      <button
                        onClick={() => downloadHistoricalCsv(sub)}
                        className="flex-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold py-1.5 px-3 rounded-lg border border-slate-200 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download CSV
                      </button>
                      <button
                        onClick={() => deleteHistoryRecord(sub.id)}
                        className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg border border-transparent hover:border-red-100 transition-colors"
                        title="Delete from list"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TOP LEVEL FIELD METADATA PANEL */}
        <section id="clerk-info-panel" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              <span className="h-5 w-1 bg-slate-900 rounded-full"></span>
              <h2 className="text-base font-bold text-slate-900">Organizational Tracking & Inventory Context</h2>
            </div>
            
            {/* Short quick setup reminder */}
            {hasHeaderValidationErrors && (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md flex items-center gap-1 animate-pulse border border-amber-200">
                <AlertTriangle className="w-3 h-3 text-amber-500" /> Must provide Clerk & Zone
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Clerk Name Input */}
            <div className={!clerkName.trim() ? "ring-2 ring-amber-100 rounded-xl p-1 bg-amber-50/10" : ""}>
              <label htmlFor="clerk-name-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Data Clerk Name <span className="text-amber-600 font-black">*</span>
              </label>
              <div className="relative font-semibold">
                <input
                  id="clerk-name-input"
                  type="text"
                  value={clerkName}
                  onChange={(e) => setClerkName(e.target.value)}
                  placeholder="Enter full name of active physical clerk"
                  className={`w-full bg-slate-50 border text-sm rounded-xl px-3.5 py-2.5 outline-hidden focus:bg-white focus:ring-2 transition-all ${
                    !clerkName.trim() 
                      ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-200' 
                      : 'border-slate-200 focus:border-slate-500 focus:ring-slate-100'
                  }`}
                />
                {!clerkName.trim() && (
                  <p className="text-amber-600 text-[11px] mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Required for submission and CSV tracking
                  </p>
                )}
              </div>
            </div>

            {/* Date of Count Input */}
            <div>
              <label htmlFor="date-clerk-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Date of Physical Count <span className="text-red-500">*</span>
              </label>
              <div>
                <input
                  id="date-clerk-input"
                  type="date"
                  value={dateOfCount}
                  onChange={(e) => setDateOfCount(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-sm rounded-xl px-3.5 py-2.5 font-bold outline-hidden focus:bg-white focus:border-slate-500 focus:ring-2 focus:ring-slate-100 transition-all text-slate-800"
                />
              </div>
            </div>

            {/* Location ID Dropdown */}
            <div className={!locationId.trim() ? "ring-2 ring-amber-100 rounded-xl p-1 bg-amber-50/10" : ""}>
              <label htmlFor="location-id-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                Location ID / Warehouse Zone <span className="text-amber-600 font-black">*</span>
              </label>
              <div className="relative font-bold">
                <select
                  id="location-id-input"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={`w-full bg-slate-50 border text-sm rounded-xl px-3.5 py-2.5 outline-hidden focus:bg-white focus:ring-2 transition-all appearance-none cursor-pointer ${
                    !locationId.trim() 
                      ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 text-slate-400' 
                      : 'border-slate-200 focus:border-slate-500 focus:ring-slate-100 text-slate-800'
                  }`}
                >
                  <option value="" className="text-slate-400">Select physical zone...</option>
                  {WAREHOUSE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc} className="text-slate-800 font-medium">
                      {loc}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
                {!locationId.trim() && (
                  <p className="text-amber-600 text-[11px] mt-1 flex items-center gap-1 font-normal">
                    <AlertTriangle className="w-3 h-3" /> Required for segregation of counts
                  </p>
                )}
              </div>
            </div>

          </div>
        </section>

        {/* UPGRADES COMPONENT: WAREHOUSE CATEGORIES PHYSICAL AUDIT MAP */}
        <section id="category-completion-audit-map" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-slate-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-none">Warehouse Category Progress Audit</h2>
                <span className="text-[11px] text-slate-500 block mt-1 hover:underline cursor-pointer">
                  Click on any category card block to instantly filter raw material listings below
                </span>
              </div>
            </div>
            
            {/* Overall summary stats */}
            <span className="text-xs font-extrabold text-slate-900 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <span>{completedCount} SKUs filled</span>
              <span className="h-2 w-2 rounded-full bg-slate-400"></span>
              <span>{totalMaterials - completedCount} empty</span>
            </span>
          </div>

          {/* Grid Layout of Categories */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {categoryStats.map((stat) => {
              const isActive = selectedCategory === stat.category;
              return (
                <button
                  key={stat.category}
                  onClick={() => setSelectedCategory(isActive ? "All" : stat.category)}
                  className={`group text-left border rounded-xl p-3 flex flex-col justify-between transition-all relative overflow-hidden select-none ${
                    isActive 
                      ? 'bg-slate-900 border-slate-900 text-white shadow-md ring-2 ring-slate-100' 
                      : stat.percentage === 100 
                        ? 'bg-emerald-50 text-emerald-950 hover:bg-emerald-100/70 hover:border-emerald-300 border-emerald-200' 
                        : stat.percentage === 0
                          ? 'bg-slate-50/50 hover:bg-slate-50 text-slate-800 border-slate-200'
                          : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-1">
                    <p className={`text-xs font-bold truncate ${isActive ? 'text-white' : 'text-slate-900'}`}>
                      {stat.category}
                    </p>
                    <div className="flex items-center justify-between gap-1 mt-1 text-[10px] font-extrabold tracking-tight">
                      <span className={stat.percentage === 100 ? (isActive ? 'text-emerald-100' : 'text-emerald-700') : (isActive ? 'text-slate-300' : 'text-slate-500')}>
                        {stat.counted} of {stat.total} SKUs
                      </span>
                      <span>
                        {stat.percentage}%
                      </span>
                    </div>
                  </div>

                  {/* Visual Completion Indicator */}
                  <div className="w-full mt-2.5">
                    <div className={`h-1 w-full rounded-full ${isActive ? 'bg-slate-700' : 'bg-slate-100'} overflow-hidden`}>
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${isActive ? 'bg-amber-400' : stat.percentage === 100 ? 'bg-emerald-600' : 'bg-slate-800'}`}
                        style={{ width: `${stat.percentage}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Corner absolute badges */}
                  {stat.percentage === 100 && !isActive && (
                    <div className="absolute top-2 right-2 p-0.5 bg-emerald-200 border border-emerald-300 text-emerald-800 rounded-full">
                      <Check className="w-2.5 h-2.5 stroke-[4]" />
                    </div>
                  )}
                </button>
              );
            })}

            {/* View All category button */}
            <button
              onClick={() => setSelectedCategory("All")}
              className={`border border-slate-200 rounded-xl p-3 text-center flex flex-col items-center justify-center transition-all ${
                selectedCategory === "All"
                  ? 'bg-slate-900 border-slate-900 text-white font-bold'
                  : 'bg-white hover:bg-slate-50 text-slate-700 hover:border-slate-300'
              }`}
            >
              <Layers className="w-4 h-4 mb-1 opacity-70" />
              <span className="text-xs font-bold">Show All Grid</span>
              <span className="text-[10px] opacity-60">({totalMaterials} Total Items)</span>
            </button>
          </div>
        </section>



        {/* PROGRESS HUD & BULK FILE ACTIONS */}
        <section id="progress-hud" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Realtime Completion progress bar */}
          <div className="w-full md:w-1/2 space-y-2">
            <div className="flex justify-between items-end">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Count Progress Status</span>
                <span className="text-xl font-extrabold text-slate-950 tracking-tight">
                  {completedCount} <span className="text-sm font-semibold text-slate-400">of</span> {totalMaterials}
                </span>
                <span className="text-xs text-slate-500 mx-2">raw materials listed</span>
              </div>
              <span className="text-sm font-extrabold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                {completionPercentage}% Complete
              </span>
            </div>
            
            {/* Premium progress bar graphic */}
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200 flex">
              <div 
                className="h-full bg-slate-900 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${completionPercentage}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-500">
              * The progress indicator reflects the percentage of items with positive physical values entered.
            </p>
          </div>

          {/* Quick tool buttons */}
          <div className="flex gap-2.5 w-full md:w-auto flex-wrap sm:flex-nowrap shrink-0">
            
            <button
              id="import-csv-modal-btn"
              onClick={() => {
                setImportStatus(null);
                setCsvPreviewRows(null);
                setImportCsvText("");
                setIsImportModalOpen(true);
              }}
              className="flex-1 sm:flex-initial bg-slate-50 hover:bg-slate-100 text-slate-800 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <FileUp className="w-4 h-4 text-slate-500" />
              <span>Import Count CSV</span>
            </button>

            <button
              id="download-template-btn"
              onClick={handleDownloadTemplate}
              className="flex-1 sm:flex-initial bg-slate-50 hover:bg-slate-100 text-slate-800 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
              title="Download master list template for physical counts"
            >
              <FileDown className="w-4 h-4 text-slate-500" />
              <span>Download Blank Template</span>
            </button>

            <button
              id="export-draft-btn"
              onClick={handleExportDraft}
              disabled={completedCount === 0}
              className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-2 transition-all ${
                completedCount === 0
                  ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300'
              }`}
              title="Download your active batch draft"
            >
              <Download className="w-4 h-4" />
              <span>Back up Active Draft</span>
            </button>

          </div>

        </section>

        {/* FILTER BAR Workspace */}
        <section id="inventory-filters" className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
            
            {/* Search filter input */}
            <div className="relative flex-1 max-w-sm">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                id="search-materials-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search raw materials by part, description..."
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-800 placeholder-slate-400 outline-hidden focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-all font-semibold"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* View selectors / Counted vs Uncounted filter */}
            <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl self-start">
              <button
                id="filter-all-btn"
                onClick={() => setCompletionFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all select-none ${
                  completionFilter === "all" 
                    ? 'bg-slate-900 text-white shadow-xs' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({totalFilteredCount})
              </button>
              <button
                id="filter-counted-btn"
                onClick={() => setCompletionFilter("counted")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all select-none ${
                  completionFilter === "counted" 
                    ? 'bg-slate-900 text-white shadow-xs' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Filled ({completedCount})
              </button>
              <button
                id="filter-uncounted-btn"
                onClick={() => setCompletionFilter("uncounted")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all select-none ${
                  completionFilter === "uncounted" 
                    ? 'bg-slate-900 text-white shadow-xs' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Blank ({totalMaterials - completedCount})
              </button>
            </div>

          </div>

          {/* Active Category Filter Ribbon indicators */}
          {selectedCategory !== "All" && (
            <div className="flex items-center gap-2 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200 w-fit">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Active Category Target:</span>
              <span className="text-xs font-extrabold text-slate-900">{selectedCategory}</span>
              <button 
                onClick={() => setSelectedCategory("All")}
                className="text-slate-400 hover:text-slate-900 p-0.5 rounded-md hover:bg-slate-200 transition-colors"
                title="Clears specific category restriction"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* WORKSPACE BATCH ENTRY TABLE */}
        <section id="batch-entry-cards" className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs relative">
          
          <div className="overflow-x-auto min-w-full">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th scope="col" className="px-6 py-3 font-bold uppercase tracking-wider w-[18%]">
                    Part Number
                  </th>
                  <th scope="col" className="px-6 py-3 font-bold uppercase tracking-wider w-[42%]">
                    Raw Material Specification
                  </th>
                  <th scope="col" className="px-6 py-3 font-bold uppercase tracking-wider w-[10%]">
                    UoM
                  </th>
                  <th scope="col" className="px-6 py-3 font-bold uppercase tracking-wider text-right pr-14 w-[30%]">
                    Physical Count Controls
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {activePageMaterialsWithCounts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                      <div className="max-w-md mx-auto space-y-1">
                        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto opacity-70 mb-2" />
                        <p className="text-sm font-bold text-slate-700">No raw materials matched criteria.</p>
                        <p className="text-xs">Adjust search query or category filter to inspect other SKUs.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  activePageMaterialsWithCounts.map((material) => {
                    const isRowFilled = material.currentVal !== "";
                    
                    return (
                      <tr 
                        key={material.partNumber} 
                        id={`row-${material.partNumber}`}
                        className={`transition-colors duration-100 ${
                          isRowFilled 
                            ? 'bg-blue-50/20 hover:bg-blue-50/45 border-l-4 border-l-blue-500' 
                            : 'hover:bg-slate-50/60 border-l-4 border-l-transparent'
                        }`}
                      >
                        
                        {/* Part Number Column */}
                        <td className="px-6 py-4.5 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 w-fit select-all">
                              {material.partNumber}
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold tracking-wide">
                              {material.category}
                            </span>
                          </div>
                        </td>

                        {/* Description Column */}
                        <td className="px-6 py-4.5">
                          <p className="text-xs font-semibold text-slate-900 leading-relaxed max-w-xl">
                            {material.description}
                          </p>
                        </td>

                        {/* UoM Badge Column */}
                        <td className="px-6 py-4.5 whitespace-nowrap">
                          <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                            {material.uom}
                          </span>
                        </td>

                        {/* Manual entry controls grouped column */}
                        <td className="px-6 py-4.5 whitespace-nowrap pr-6">
                          <div className="flex flex-col items-end gap-1.5">
                            
                            <div className="flex items-center gap-1">
                              
                              {/* -5 physical change button */}
                              <button
                                type="button"
                                onClick={() => adjustCountBy(material.partNumber, -5)}
                                className="h-8 w-10 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-xs font-extrabold rounded-lg border border-slate-300 transition-colors inline-none select-none"
                                title="Subtract 5 units"
                              >
                                -5
                              </button>

                              {/* Input Box positioned between -5 and +5, as explicitly described */}
                              <div className="relative">
                                <input
                                  type="text"
                                  ref={(el) => {
                                    inputRefs.current[material.partNumber] = el;
                                  }}
                                  value={material.currentVal}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateCountState(material.partNumber, val);
                                  }}
                                  onKeyDown={(e) => handleInputKeyDown(e, material.partNumber, activePageMaterialsWithCounts)}
                                  placeholder="0.00"
                                  className={`w-24 h-8 px-2.5 text-center text-xs font-black rounded-lg bg-white border outline-hidden transition-all focus:ring-2 focus:ring-slate-900 ${
                                    material.error 
                                      ? 'border-red-400 text-red-900 focus:border-red-500 focus:ring-red-200 bg-red-50/30' 
                                      : isRowFilled 
                                        ? 'border-blue-400 text-slate-900 font-black focus:border-blue-500 focus:ring-blue-100 bg-blue-50/10' 
                                        : 'border-slate-300 text-slate-700 focus:border-slate-500 focus:ring-slate-100 hover:border-slate-400'
                                  }`}
                                  title={`Enter count in ${material.uom}`}
                                />
                                {isRowFilled && (
                                  <span className="absolute right-1 text-[9px] text-slate-400 font-bold bg-white/70 px-0.5 select-none pointer-events-none">
                                    {material.uom}
                                  </span>
                                )}
                              </div>

                              {/* +5 positive change button */}
                              <button
                                type="button"
                                onClick={() => adjustCountBy(material.partNumber, 5)}
                                className="h-8 w-10 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-xs font-extrabold rounded-lg border border-slate-300 transition-colors inline-none select-none"
                                title="Add 5 units"
                              >
                                +5
                              </button>

                              {/* +10 helper button */}
                              <button
                                type="button"
                                onClick={() => adjustCountBy(material.partNumber, 10)}
                                className="h-8 w-10 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-lg transition-colors inline-none select-none"
                                title="Add 10 units"
                              >
                                +10
                              </button>

                              {/* +20 helper button */}
                              <button
                                type="button"
                                onClick={() => adjustCountBy(material.partNumber, 20)}
                                className="h-8 w-10 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-lg transition-colors inline-none select-none"
                                title="Add 20 units"
                              >
                                +20
                              </button>

                              {/* +50 helper button */}
                              <button
                                type="button"
                                onClick={() => adjustCountBy(material.partNumber, 50)}
                                className="h-8 w-10 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-lg transition-colors inline-none select-none"
                                title="Add 50 units"
                              >
                                +50
                              </button>

                              {/* Clear specific entry */}
                              {isRowFilled && (
                                <button
                                  type="button"
                                  onClick={() => updateCountState(material.partNumber, "")}
                                  className="p-1 text-slate-400 hover:text-red-500 rounded border border-transparent hover:border-slate-200 transition-all ml-1"
                                  title="Clear specific count"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                              )}

                            </div>

                            {/* Line Validation Prompting */}
                            {material.error ? (
                              <p className="text-red-500 text-[10px] font-bold text-right leading-none pr-1">
                                {material.error}
                              </p>
                            ) : isRowFilled ? (
                              <p className="text-emerald-600 text-[10px] font-bold text-right leading-none pr-1 flex items-center justify-end gap-0.5">
                                <Check className="w-2.5 h-2.5" /> Checked Physical Count
                              </p>
                            ) : null}

                          </div>
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* TABLE FOOTER / PAGINATION CONTROLLER */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            
            <div className="text-xs text-slate-500 font-bold">
              Showing <span className="text-slate-800">{totalFilteredCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}</span> to{" "}
              <span className="text-slate-800">
                {Math.min(currentPage * itemsPerPage, totalFilteredCount)}
              </span>{" "}
              of <span className="text-slate-800">{totalFilteredCount}</span> matched materials
              {selectedCategory !== "All" && ` in ${selectedCategory}`}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1">
              
              <button
                id="pagination-prev-btn"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Show compact numbers */}
              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1;
                if (totalPages > 6 && Math.abs(pageNum - currentPage) > 1 && pageNum !== 1 && pageNum !== totalPages) {
                  if (pageNum === 2 || pageNum === totalPages - 1) {
                    return <span key={pageNum} className="text-slate-400 px-1 text-xs select-none">...</span>;
                  }
                  return null;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`h-8 min-w-8 px-2.5 text-xs font-extrabold rounded-lg border transition-all ${
                      currentPage === pageNum
                        ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                id="pagination-next-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

            </div>

          </div>

        </section>

      </main>

      {/* STICKY BOTTOM CONTROL & VALIDATION BAR */}
      <footer id="sticky-submit-rail" className="bg-white border-t border-slate-200 px-4 py-4.5 sticky bottom-0 z-20 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          
          <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">Draft summary status</p>
              <p className="text-slate-900 font-bold mt-1.5 flex items-center gap-1 justify-center sm:justify-start">
                <span className="font-extrabold">{itemsForSubmission.length}</span> items prepared for record submission!
              </p>
            </div>
            {hasHeaderValidationErrors && (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Please specify Clerk Name & Location ID before submitting
              </span>
            )}
            {Object.keys(validationErrors).length > 0 && (
              <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-3 py-1 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Has {Object.keys(validationErrors).length} invalid inputs!
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            
            <button
              id="clear-all-draft-btn"
              onClick={handleClearAllCounts}
              disabled={completedCount === 0}
              className={`flex-1 sm:flex-initial text-xs font-bold px-4 py-2.5 rounded-xl border flex items-center justify-center gap-2 transition-all ${
                completedCount === 0
                  ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-white hover:bg-neutral-100 text-slate-700 border-slate-300 cursor-pointer active:scale-98'
              }`}
            >
              <Trash2 className="w-4 h-4 text-slate-400" />
              <span>Reset Batch</span>
            </button>

            <button
              id="review-submittal-btn"
              onClick={() => setIsConfirmModalOpen(true)}
              disabled={isSubmissionDisabled}
              className={`flex-1 sm:flex-initial text-xs font-black px-6 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-all active:scale-98 ${
                isSubmissionDisabled
                  ? 'bg-slate-200 border border-slate-300 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-slate-950 border border-slate-950 text-white hover:bg-slate-800 cursor-pointer'
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>Review & Submit Batch Count</span>
            </button>

          </div>

        </div>
      </footer>

      {/* MODAL: SANDBOXED SAFE FILE IMPORT CSV */}
      {isImportModalOpen && (
        <div id="import-modal" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-45 animate-fadeIn">
          <div className="bg-white border text-slate-900 max-w-3xl w-full rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <FileUp className="w-5 h-5 text-slate-600" />
                  Import Counts via Sandboxed CSV Format
                </h3>
                <p className="text-xs text-slate-500 mt-1">Review validation results and unlisted SKU warnings safely before merging spreadsheets.</p>
              </div>
              <button 
                onClick={() => {
                  setIsImportModalOpen(false);
                  setCsvPreviewRows(null);
                  setImportStatus(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main scrollable body of sandbox */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              
              {!csvPreviewRows ? (
                // IF NO PREVIEW LOADED: show file upload input or textbox paste
                <form onSubmit={handleCsvImportSubmit} className="space-y-4 flex flex-col">
                  
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
                    <p className="font-bold text-slate-700">Supported File Formatting:</p>
                    <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
                      <li>Simple Layout: <code className="font-mono bg-slate-250 text-slate-800 px-1 rounded">Part number, Count</code></li>
                      <li>Standard physical templates layout works out-of-the-box!</li>
                    </ul>
                  </div>

                  {/* Drag and Drop Zone */}
                  <div 
                    id="dropzone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 hover:bg-slate-50 hover:border-slate-400 rounded-xl p-6 text-center cursor-pointer transition-all space-y-2 select-none"
                  >
                    <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-400" />
                    <div>
                      <span className="text-xs font-bold text-slate-900">Drag and drop raw counts CSV here</span>
                      <span className="text-xs text-slate-500 block mt-1">or click to browse local files</span>
                    </div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".csv"
                      className="hidden"
                    />
                  </div>

                  {/* Paste Box */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Or Paste raw CSV text values:
                    </label>
                    <textarea
                      className="w-full h-[180px] p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:bg-white focus:border-slate-500 focus:ring-1 focus:ring-slate-550 resize-none"
                      placeholder="Part number,Count&#10;RM-WD-TB737,45&#10;RM-WD-TB738,12"
                      value={importCsvText}
                      onChange={(e) => setImportCsvText(e.target.value)}
                    />
                  </div>

                  {importStatus && !importStatus.success && (
                    <div className="p-3 bg-red-50 border border-red-250 text-red-800 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-650 shrink-0" />
                      <span>{importStatus.message}</span>
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setIsImportModalOpen(false)}
                      className="bg-white hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      Process & Inspect Rows
                    </button>
                  </div>

                </form>
              ) : (
                // IF PREVIEW IS LOADED: Show sandbox safety checks list
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 flex-wrap gap-2">
                    <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono">
                        {csvPreviewRows.length} SKUs detected
                      </span>
                      <span>Review physical parsed properties:</span>
                    </span>

                    <button 
                      onClick={() => setCsvPreviewRows(null)}
                      className="text-xs text-rose-600 hover:underline font-bold"
                    >
                      ← Reset Sandbox / Upload New File
                    </button>
                  </div>

                  {/* Sandboxed Review Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[350px] overflow-y-auto">
                    <table className="min-w-full text-xs text-left divide-y divide-slate-200">
                      <thead className="bg-slate-50 sticky top-0 font-bold text-slate-500">
                        <tr>
                          <th className="px-4 py-2 w-[8%]">Line</th>
                          <th className="px-4 py-2 w-[22%]">SKU / Code</th>
                          <th className="px-4 py-2 w-[40%]">Sourced Specification</th>
                          <th className="px-4 py-2 w-[15%] text-right">Physical Count</th>
                          <th className="px-4 py-2 w-[15%] text-center">Status Check</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200">
                        {csvPreviewRows.map((row, idx) => (
                          <tr 
                            key={idx} 
                            className={`hover:bg-slate-50/50 ${
                              !row.isValid 
                                ? 'bg-red-50/20' 
                                : row.warning 
                                  ? 'bg-amber-50/20' 
                                  : 'bg-emerald-50/10'
                            }`}
                          >
                            <td className="px-4 py-2 font-mono text-slate-400">{row.rowIndex}</td>
                            <td className="px-4 py-2 font-mono font-bold text-slate-900">{row.partNumber}</td>
                            <td className="px-4 py-2 font-medium">
                              <span className="block truncate max-w-sm text-slate-700">
                                {row.description}
                              </span>
                              {row.warning && (
                                <span className="text-[10px] text-amber-600 font-bold block mt-0.5">
                                  ⚠️ {row.warning}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-extrabold text-slate-900">
                              {row.parsedQty} <span className="text-[10px] font-bold text-slate-500">{row.uom}</span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              {row.isValid ? (
                                <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                                  Valid Match
                                </span>
                              ) : (
                                <span className="bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase" title={row.description}>
                                  Failed Check
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary counts */}
                  <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-550 font-semibold block">Total approved updates:</span>
                      <span className="font-extrabold text-emerald-700 text-sm">
                        {csvPreviewRows.filter(r => r.isValid).length}SKU items will be applied
                      </span>
                    </div>

                    {csvPreviewRows.some(r => !r.isValid) && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1">
                        ⚠️ {csvPreviewRows.filter(r => !r.isValid).length} invalid rows will be ignored on merge
                      </span>
                    )}
                  </div>

                  <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setCsvPreviewRows(null);
                        setIsImportModalOpen(false);
                      }}
                      className="bg-white hover:bg-slate-100 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 transition-all cursor-pointer"
                    >
                      Discard Sandbox
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveAndMergeCsv}
                      className="bg-slate-950 hover:bg-slate-800 text-white px-5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Confirm & Merge Into Draft</span>
                    </button>
                  </div>

                </div>
              )}

            </div>

          </div>
        </div>
      )}

      {/* MODAL: SUBMISSION REVIEW CONFIRMATION */}
      {isConfirmModalOpen && (
        <div id="confirm-modal" className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fadeIn">
          <div className="bg-white border text-slate-900 max-w-3xl w-full rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[85vh]">
            
            {/* Header bar */}
            <div className="p-5 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-slate-700" />
                  Pre-Submission Review & Audit
                </h3>
                <p className="text-xs text-slate-500 mt-1">Please confirm that all physical raw material counts are accurate below.</p>
              </div>
              <button 
                onClick={() => setIsConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Audit body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Submission Information Sheet */}
              <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-50 p-4 border border-slate-200 rounded-xl gap-4">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Primary Data Clerk</span>
                  <span className="block text-slate-900 font-bold mt-1 text-sm">{clerkName}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Warehouse Zone / Location</span>
                  <span className="block text-slate-900 font-bold mt-1 text-sm">{locationId.toUpperCase()}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Effective Count Date</span>
                  <span className="block text-slate-900 font-bold mt-1 text-sm">{dateOfCount}</span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Items with Count Data ({itemsForSubmission.length} SKUs)
                </h4>
                <div className="text-xs text-slate-500 font-bold">
                  Total Units Sum:{" "}
                  <span className="text-slate-900 font-extrabold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                    {itemsForSubmission.reduce((a, b) => a + b.count, 0)}
                  </span>
                </div>
              </div>

              {/* Items physical table view */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
                  <thead className="bg-slate-50 sticky top-0 font-bold text-slate-500">
                    <tr>
                      <th className="px-4 py-2 w-[25%] border-b border-slate-200">Part Number</th>
                      <th className="px-4 py-2 w-[55%] border-b border-slate-200">Description</th>
                      <th className="px-4 py-2 text-right pr-6 w-[20%] border-b border-slate-200">Physical Count</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-200">
                    {itemsForSubmission.map((item) => (
                      <tr key={item.partNumber} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2 font-mono font-bold text-slate-800">{item.partNumber}</td>
                        <td className="px-4 py-2 font-semibold text-slate-600">{item.description}</td>
                        <td className="px-4 py-2 text-right pr-6 font-mono font-extrabold text-slate-900">
                          {item.count} <span className="text-[10px] font-bold text-slate-500">{item.uom}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Notification note */}
              <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 flex gap-3 text-xs text-blue-800 leading-relaxed">
                <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-blue-955">What happens after submitting?</p>
                  <p className="mt-0.5 font-semibold text-blue-700">
                    An official certified CSV spreadsheet will immediately download containing both organizational tracking metadata and inventory logs. This session is persistent and will also save directly to local history catalogs.
                  </p>
                </div>
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="p-5 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="bg-white hover:bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold transition-all active:scale-98"
              >
                Go Back & Edit
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                className="bg-slate-950 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all shadow-xs active:scale-98"
              >
                Confirm & Submit Count
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
