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
import { WIP_ITEMS, WipItem } from "./wipItems";
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
    processStage?: string;
  }[];
  totalItemsCounted: number;
  totalQuantity: number;
  cycle?: string;
  weekNumber?: number;
  countMode?: string;
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
  "Manufacturing Timber storage",
  "Manufacturing small store"
];

function getWeekNumber(dateStr: string): number | "" {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

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
  const [cycle, setCycle] = useState<string>(() => {
    return localStorage.getItem("batch_cycle") || "Weekly count";
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

  // --- Tracking Mode and WIP specific states ---
  const [countingMode, setCountingMode] = useState<"raw_materials" | "wip">((): "raw_materials" | "wip" => {
    return (localStorage.getItem("batch_counting_mode") as "raw_materials" | "wip") || "raw_materials";
  });
  const [selectedWipProductCategory, setSelectedWipProductCategory] = useState<string>("All");
  const [selectedWipStage, setSelectedWipStage] = useState<string>("All");
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdIntervalRef = useRef<any>(null);

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

  // --- WIP Constants and Options ---
  const wipProductCategories = ["All", "Hug Bed", "TV Stand", "Coffee Table", "C table"];

  const WIP_PROCESS_STAGES = useMemo(() => [
    "Machining Done",
    "Joinery Done",
    "Body Filling Done",
    "Body Filler Sanding Done",
    "Priming Done",
    "Spot Filling Done",
    "Spot Putty Sanding Done",
    "Color Coating Done"
  ], []);

  // --- Real-Time Statistics per WIP Process Stage (WIP Card Block) ---
  const wipStageStats = useMemo(() => {
    return WIP_PROCESS_STAGES.map(stage => {
      const stageItems = WIP_ITEMS.filter(m => {
        const matchesStage = m.processStage === stage;
        const matchesProduct = selectedWipProductCategory === "All" || m.productCategory === selectedWipProductCategory;
        return matchesStage && matchesProduct;
      });

      const totalCount = stageItems.length;
      const countedCount = stageItems.filter(m => {
        const val = counts[m.partNumber];
        return val !== undefined && val !== "" && !isNaN(Number(val)) && Number(val) >= 0;
      }).length;

      const pct = totalCount > 0 ? Math.round((countedCount / totalCount) * 100) : 0;

      return {
        stage,
        total: totalCount,
        counted: countedCount,
        percentage: pct,
        isCompleted: countedCount === totalCount && totalCount > 0
      };
    });
  }, [counts, selectedWipProductCategory, WIP_PROCESS_STAGES]);

  // --- Unified Mode Statistics ---
  const totalItems = useMemo(() => {
    return countingMode === "raw_materials" ? RAW_MATERIALS.length : WIP_ITEMS.length;
  }, [countingMode]);

  const activeCompletedCount = useMemo(() => {
    const list = countingMode === "raw_materials" ? RAW_MATERIALS : WIP_ITEMS;
    return list.filter(item => {
      const val = counts[item.partNumber];
      return val !== undefined && val !== "" && !isNaN(Number(val)) && Number(val) >= 0;
    }).length;
  }, [counts, countingMode]);

  const activeCompletionPercentage = useMemo(() => {
    if (totalItems === 0) return 0;
    return Math.round((activeCompletedCount / totalItems) * 100);
  }, [activeCompletedCount, totalItems]);

  // Backward compatibility aliases
  const totalMaterials = RAW_MATERIALS.length;
  const completedCount = activeCompletedCount;
  const completionPercentage = activeCompletionPercentage;

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
      } else if (!Number.isInteger(val)) {
        const isWip = countingMode === "wip";
        const isDiscreteRm = countingMode === "raw_materials" && (
          partNum.toLowerCase().includes("pcs") || 
          partNum.toLowerCase().includes("pc") || 
          partNum.toLowerCase().includes("pkts")
        );
        if (isWip || isDiscreteRm) {
          errors[partNum] = "Discrete units require whole numbers (integers)";
        }
      }
    });
    return errors;
  }, [counts, countingMode]);

  // --- Save states to localStorage with debouncing for latency-free typing performance ---
  useEffect(() => {
    let notifyTimer: any;
    const timer = setTimeout(() => {
      localStorage.setItem("batch_clerk_name", clerkName);
      localStorage.setItem("batch_date_of_count", dateOfCount);
      localStorage.setItem("batch_location_id", locationId);
      localStorage.setItem("batch_cycle", cycle);
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
  }, [clerkName, dateOfCount, locationId, cycle, counts]);

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
  }, [searchQuery, selectedCategory, selectedWipProductCategory, selectedWipStage, completionFilter, countingMode]);

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

  // --- Hold-to-Toggle Dashboard mode Event Handlers ---
  const startHoldingModeToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsHolding(true);
    setHoldProgress(0);
    
    const startTime = Date.now();
    const duration = 1200; // 1.2 seconds

    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);
      setHoldProgress(progress);

      if (progress >= 100) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
        setIsHolding(false);
        setHoldProgress(0);
        triggerModeToggle();
      }
    }, 20);
  };

  const stopHoldingModeToggle = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setIsHolding(false);
    setHoldProgress(0);
  };

  const triggerModeToggle = () => {
    const nextMode = countingMode === "raw_materials" ? "wip" : "raw_materials";
    const hasUnsavedCounts = Object.values(counts).some(c => c !== "");
    
    if (hasUnsavedCounts) {
      const confirmSwitch = window.confirm(
        `Confirm Mode Switch\n\nYou currently have active counts entered in this session. Switching to ${
          nextMode === "wip" ? "Work In Progress (WIP)" : "Raw Materials"
        } mode will change the list of items.\n\nAre you sure you want to switch tracking mode?`
      );
      if (!confirmSwitch) {
        return;
      }
    }
    
    setCountingMode(nextMode);
    localStorage.setItem("batch_counting_mode", nextMode);
    
    setSelectedCategory("All");
    setSelectedWipStage("All");
    setSelectedWipProductCategory("All");
    setCurrentPage(1);
  };



  // --- Filtered and Searched Items ---
  const activeFilteredItems = useMemo(() => {
    if (countingMode === "raw_materials") {
      return RAW_MATERIALS.filter(item => {
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          item.partNumber.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query);

        const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;

        const hasCount = counts[item.partNumber] !== undefined && counts[item.partNumber] !== "";
        const matchesCompletion = 
          completionFilter === "all" ||
          (completionFilter === "counted" && hasCount) ||
          (completionFilter === "uncounted" && !hasCount);

        return matchesSearch && matchesCategory && matchesCompletion;
      });
    } else {
      return WIP_ITEMS.filter(item => {
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          item.partNumber.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.productCategory.toLowerCase().includes(query) ||
          item.processStage.toLowerCase().includes(query);

        const matchesProductCategory = selectedWipProductCategory === "All" || item.productCategory === selectedWipProductCategory;

        const matchesStage = selectedWipStage === "All" || item.processStage === selectedWipStage;

        const hasCount = counts[item.partNumber] !== undefined && counts[item.partNumber] !== "";
        const matchesCompletion = 
          completionFilter === "all" ||
          (completionFilter === "counted" && hasCount) ||
          (completionFilter === "uncounted" && !hasCount);

        return matchesSearch && matchesProductCategory && matchesStage && matchesCompletion;
      });
    }
  }, [countingMode, searchQuery, selectedCategory, selectedWipProductCategory, selectedWipStage, completionFilter, counts]);

  // Backward compatibility alias
  const filteredMaterials = activeFilteredItems;

  // --- Paginated materials / WIP ---
  const totalFilteredCount = activeFilteredItems.length;
  const totalPages = Math.ceil(totalFilteredCount / itemsPerPage) || 1;
  
  const paginatedMaterials = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return activeFilteredItems.slice(startIdx, startIdx + itemsPerPage);
  }, [activeFilteredItems, currentPage]);

  const activePageMaterialsWithCounts = useMemo(() => {
    return paginatedMaterials.map(mat => ({
      ...mat,
      // Provide category mapping dynamically so item grid cards work flawlessly!
      category: countingMode === "raw_materials" ? (mat as any).category : (mat as any).productCategory,
      currentVal: counts[mat.partNumber] || "",
      error: validationErrors[mat.partNumber]
    }));
  }, [paginatedMaterials, counts, validationErrors, countingMode]);

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
    const activeList = countingMode === "raw_materials" ? RAW_MATERIALS : WIP_ITEMS;
    const isWip = countingMode === "wip";
    
    const headers = [
      "Part number", 
      isWip ? "WIP Description" : "Raw material description", 
      isWip ? "Product category" : "Category", 
      "UoM", 
      "Suggested Count (Insert Counts Here)"
    ];
    
    const rows = activeList.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      isWip ? (m as any).productCategory : (m as any).category,
      m.uom,
      ""
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const namePrefix = isWip ? "WIP" : "RM";
    triggerDownload(csvContent, `${namePrefix}_Physical_Count_Template.csv`);
  };

  // --- Export Draft Counts CSV ---
  const handleExportDraft = () => {
    const activeList = countingMode === "raw_materials" ? RAW_MATERIALS : WIP_ITEMS;
    const isWip = countingMode === "wip";
    
    const headers = [
      "Part number", 
      isWip ? "WIP Description" : "Raw material description", 
      isWip ? "Product category" : "Category", 
      "UoM", 
      "Counted Progress"
    ];
    
    const rows = activeList.map(m => [
      m.partNumber,
      `"${m.description.replace(/"/g, '""')}"`,
      isWip ? (m as any).productCategory : (m as any).category,
      m.uom,
      counts[m.partNumber] || ""
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const namePrefix = isWip ? "WIP" : "RM";
    triggerDownload(csvContent, `Draft_${namePrefix}_Count_${locationId || "unspecified"}_${dateOfCount}.csv`);
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
        const activeList = countingMode === "raw_materials" ? RAW_MATERIALS : WIP_ITEMS;
        const matchedMaterial = activeList.find(rm => rm.partNumber.toUpperCase() === rawSku);
        if (!matchedMaterial) {
          previewRowsList.push({
            rowIndex: i + 1,
            partNumber: rawSku || "EMPTY",
            originalPartNumber: originalSKU,
            parsedQty: rawQtyStr,
            uom: "N/A",
            category: "N/A",
            description: `SKU "${rawSku}" does not exist in active ${countingMode === "raw_materials" ? "raw material" : "WIP"} records roster`,
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
        const itemCategory = countingMode === "raw_materials" 
          ? (matchedMaterial as any).category 
          : (matchedMaterial as any).productCategory;

        if (isNaN(numericCount) || numericCount < 0) {
          previewRowsList.push({
            rowIndex: i + 1,
            partNumber: matchedMaterial.partNumber,
            originalPartNumber: originalSKU,
            parsedQty: rawQtyStr,
            uom: matchedMaterial.uom,
            category: itemCategory,
            description: matchedMaterial.description,
            isValid: false,
            warning: `Could not parse count value "${rawQtyStr}"`
          });
          continue;
        }

        const isWholeUnit = matchedMaterial.partNumber.includes("PCS") || 
                            matchedMaterial.partNumber.includes("PC") || 
                            matchedMaterial.partNumber.includes("PKTS") ||
                            countingMode === "wip";
        const isDecimalIssue = isWholeUnit && !Number.isInteger(numericCount);

        previewRowsList.push({
          rowIndex: i + 1,
          partNumber: matchedMaterial.partNumber,
          originalPartNumber: originalSKU,
          parsedQty: numericCount.toString(),
          uom: matchedMaterial.uom,
          category: itemCategory,
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
    const activeList = countingMode === "raw_materials" ? RAW_MATERIALS : WIP_ITEMS;
    return activeList.map(m => {
      const rawCount = counts[m.partNumber];
      const countNum = (rawCount === undefined || rawCount === "") ? null : Number(rawCount);
      return {
        partNumber: m.partNumber,
        description: m.description,
        category: countingMode === "raw_materials" ? (m as any).category : (m as any).productCategory,
        uom: m.uom,
        count: countNum,
        processStage: countingMode === "wip" ? (m as any).processStage : undefined
      };
    }).filter((subItem): subItem is typeof subItem & { count: number } => {
      return subItem.count !== null && !isNaN(subItem.count);
    });
  }, [countingMode, counts]);

  const hasHeaderValidationErrors = !clerkName.trim() || (countingMode === "raw_materials" && !locationId.trim()) || !dateOfCount || !cycle.trim();
  const isSubmissionDisabled = itemsForSubmission.length === 0 || hasHeaderValidationErrors || Object.keys(validationErrors).length > 0;

  const escapeCsv = (str: any) => {
    const s = str === null || str === undefined ? "" : String(str);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleFinalSubmit = () => {
    if (isSubmissionDisabled) return;

    // Create submitted record
    const totalQty = itemsForSubmission.reduce((acc, curr) => acc + curr.count, 0);
    const calculatedWeek = getWeekNumber(dateOfCount);
    const newSubmission: Submission = {
      id: `SUB-${Date.now()}`,
      timestamp: new Date().toLocaleString(),
      clerkName: clerkName.trim(),
      dateOfCount,
      locationId: countingMode === "wip" ? "WIP STAGES" : locationId.trim().toUpperCase(),
      items: itemsForSubmission,
      totalItemsCounted: itemsForSubmission.length,
      totalQuantity: totalQty,
      cycle: cycle.trim(),
      weekNumber: typeof calculatedWeek === "number" ? calculatedWeek : undefined,
      countMode: countingMode
    };

    setSubmissions(prev => [newSubmission, ...prev]);
    setIsConfirmModalOpen(false);

    // Build downloadable flat CSV formatted in requested tabular structure:
    // Count Date | Coverage | Cycle | Location | UID | Part Number | Part Description | Quantity
    const headers = [
      "Count Date",
      "Coverage",
      "Cycle",
      "Location",
      "UID",
      "Part Number",
      "Part Description",
      "Quantity"
    ];

    const rows = itemsForSubmission.map(m => [
      escapeCsv(dateOfCount),
      escapeCsv(m.category), // This correctly holds m.category for RM and m.productCategory for WIP
      escapeCsv(cycle.trim()),
      escapeCsv(countingMode === "wip" ? m.processStage || "" : locationId.toUpperCase()),
      "", // UID is always blank
      escapeCsv(m.partNumber),
      escapeCsv(m.description),
      escapeCsv(m.count)
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const modePrefix = countingMode === "wip" ? "WIP" : "RM";
    const locNameForFile = countingMode === "wip" ? "WIP_STAGES" : locationId.toUpperCase();
    triggerDownload(csvContent, `FINAL_${modePrefix}_Report_${locNameForFile}_${dateOfCount}.csv`);

    // Flag success view
    setSubmitSuccess(`Submission report successfully generated and downloaded! Record added to history.`);
    
    // Clear counts state so they can safely start on a new physical counting batch
    setCounts({});
  };

  const downloadHistoricalCsv = (sub: Submission) => {
    const headers = [
      "Count Date",
      "Coverage",
      "Cycle",
      "Location",
      "UID",
      "Part Number",
      "Part Description",
      "Quantity"
    ];

    const subCycle = sub.cycle || "Weekly count";
    const subMode = sub.countMode || (sub.items[0]?.partNumber.startsWith("WP-") ? "wip" : "raw_materials");

    const rows = sub.items.map(m => [
      escapeCsv(sub.dateOfCount),
      escapeCsv(m.category), // category maps to productCategory / category details 
      escapeCsv(subCycle),
      escapeCsv(subMode === "wip" ? m.processStage || "" : sub.locationId.toUpperCase()),
      "", // UID is always blank
      escapeCsv(m.partNumber),
      escapeCsv(m.description),
      escapeCsv(m.count)
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const modeLabel = subMode === "wip" ? "WIP" : "RM";
    const locLabelForFile = subMode === "wip" ? "WIP_STAGES" : sub.locationId.toUpperCase();
    triggerDownload(csvContent, `Historical_${modeLabel}_Report_${locLabelForFile}_${sub.dateOfCount}.csv`);
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
                {countingMode === "raw_materials" ? "Raw Material Physical Inventory Count" : "Work In Progress (WIP) Physical Count"}
                <span className="text-[10px] sm:text-xs font-normal bg-amber-500 text-slate-950 px-2 sm:px-2.5 py-0.5 rounded-full font-bold shrink-0">
                  {countingMode === "raw_materials" ? "Active Audit Form" : "Process Stage Audit"}
                </span>
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-500 font-medium truncate sm:whitespace-normal">
                {countingMode === "raw_materials" 
                  ? "Standardized stock-counting interface for warehouse sections & production zones" 
                  : "Standardized stock-counting interface for assembly parts & process-stage components"}
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
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <User className="w-5 h-5 text-amber-600" />
                      <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Step 1: Set Up Work & WIP Tracking Details</h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      First establish the organizational logging context. This guarantees that your final report attributes counts to the proper clerk and location.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div className="bg-white border-l-4 border-l-slate-850 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-full font-extrabold uppercase">
                          📦 Raw Material Mode
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Requires both your <strong>Clerk Name</strong> and a physical <strong>Location ID/Warehouse Zone</strong> (e.g., Raw Material Yard, Paint Store) to cluster raw stock rows.
                        </p>
                      </div>
                      <div className="bg-white border-l-4 border-l-amber-500 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-extrabold uppercase border border-amber-200">
                          ⚙️ WIP Assembly Mode
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Requires only your <strong>Clerk Name</strong>. The <strong>Location dropdown is automatically deactivated</strong> because WIP items assign their registered <strong>Process Stage</strong> as the Location field in reports.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {tutorialStep === 1 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-5 h-5 text-amber-600" />
                      <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Step 2: Section-by-Section Bento Audit Maps</h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Use the interactive bento indicators to visually scan audit completions and filter table results with one click.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div className="bg-white border-l-4 border-l-slate-850 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-full font-extrabold uppercase">
                          📦 Warehouse Category Map
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Click cards like <strong>Steel Bars</strong>, <strong>Liquid Paints</strong>, or <strong>Hardwood</strong>. The raw material checklist instantly filters to show items of that chosen category to coordinate section audits.
                        </p>
                      </div>
                      <div className="bg-white border-l-4 border-l-amber-500 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-extrabold uppercase border border-amber-200 font-mono">
                          ⚙️ WIP Assembly Stage Map
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Tracks <strong>8 active production stages</strong> (e.g., Mold Prep, Machining, Color Coating). Filter items by stage AND optionally restrict views by <strong>Product Category family</strong>.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {tutorialStep === 2 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-5 h-5 text-amber-600" />
                      <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Step 3: Rapid Keyboard Inputs & Safety Constraints</h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Complete counting tasks 10x faster using mouse-free key binds, while build-in safety validation checks prevent entry mistakes.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div className="bg-white border-l-4 border-l-slate-850 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-full font-extrabold uppercase">
                          📦 RM Whole vs. Decimal Counts
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Fractions (decimals) are supported for continuous raw materials (e.g. Kg, Liters, Rolls). Standard unit items (e.g., PCS, PKTS) will flag integer warnings if decimals are typed.
                        </p>
                      </div>
                      <div className="bg-white border-l-4 border-l-amber-500 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-extrabold uppercase border border-amber-200">
                          ⚙️ WIP Integer-Only Assurance
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Since WIP represents physically distinct assembly units, <strong>whole numbers are strictly required</strong>. Decimals are proactively flagged as validation warning errors to block faulty entries.
                        </p>
                      </div>
                    </div>
                    <div className="text-[10px] text-amber-805 font-semibold bg-amber-100/50 border border-amber-200/40 px-3 py-2 rounded-xl flex items-center gap-2">
                      <span className="bg-amber-500 text-white font-extrabold px-1.5 py-0.5 rounded uppercase text-[8px]">PRO TIP</span>
                      <span>Inside any row input cell, press <strong>Arrow Up/Down</strong> or click <strong>Enter</strong> to instantly cycle focus on rows above or below. Avoid mouse clicks completely!</span>
                    </div>
                  </div>
                )}

                {tutorialStep === 3 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <FileSpreadsheet className="w-5 h-5 text-amber-600" />
                      <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">Step 4: CSV Import Sandboxing & Structured Reports</h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Pre-verify offline worksheet uploads inside our sandbox environment before committing them, then download standard reports.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div className="bg-white border-l-4 border-l-slate-850 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-full font-extrabold uppercase">
                          📦 RM Report Generation
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          Generates flat layouts containing your chosen Location ID. The offline sandbox matches SKUs to the raw materials master and highlights mismatch warnings immediately.
                        </p>
                      </div>
                      <div className="bg-white border-l-4 border-l-amber-500 border-y border-r border-slate-200/80 rounded-xl p-4 space-y-2">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-extrabold uppercase border border-amber-200">
                          ⚙️ WIP Report Generation
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                          WIP reports map each item's registered <strong>Process Stage</strong> into the <em>Location</em> column. The WIP sandbox autoconditions input rows and handles stage associations.
                        </p>
                      </div>
                    </div>
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

        {/* DUAL DASHBOARD MODE SWITCHER CONTROLLER (WITH ACCIDENTAL TAP PROTECTION) */}
        <section id="dashboard-mode-switcher" className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs relative overflow-hidden transition-all">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500"></div>
          
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            
            {/* MODE DISPLAY SIDE 1: Raw Materials */}
            <div className={`flex-1 w-full p-4 rounded-2xl border transition-all ${
              countingMode === "raw_materials" 
                ? "bg-indigo-50/40 border-indigo-200 shadow-xs" 
                : "bg-slate-50/50 border-slate-100 opacity-60"
            }`}>
              <div className="flex items-center gap-3.5">
                <div className={`p-3 rounded-xl ${
                  countingMode === "raw_materials" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-black text-slate-900 leading-none">Raw Materials Catalog</h3>
                    {countingMode === "raw_materials" && (
                      <span className="text-[9px] font-black uppercase text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">Active</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">Timber logs, MDF board variants, and warehouse consumables</p>
                </div>
              </div>
            </div>

            {/* INTERACTIVE CENTRAL SAFETY HOLD SWITCH */}
            <div className="shrink-0 flex flex-col items-center justify-center gap-2 px-2 py-1 bg-slate-100 hover:bg-slate-200/65 border border-slate-200/80 rounded-2xl select-none w-full lg:w-[320px]">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center mt-1 block">
                Safety Mode Latch Controller
              </span>
              
              <button
                type="button"
                onMouseDown={startHoldingModeToggle}
                onMouseUp={stopHoldingModeToggle}
                onMouseLeave={stopHoldingModeToggle}
                onTouchStart={startHoldingModeToggle}
                onTouchEnd={stopHoldingModeToggle}
                className={`relative w-full h-[46px] rounded-xl overflow-hidden font-black text-xs uppercase tracking-wider transition-all duration-150 select-none cursor-pointer flex items-center justify-center shadow-xs ${
                  isHolding 
                    ? "bg-slate-800 text-amber-300 scale-98 ring-2 ring-slate-400" 
                    : "bg-slate-900 text-indigo-100 hover:bg-black"
                }`}
                title="Hold mouse click or smartphone press to confirm mode switch"
              >
                {/* Real-time Loading progress filling background overlay */}
                <div 
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500 opacity-30 transition-all duration-75"
                  style={{ width: `${holdProgress}%` }}
                ></div>
                
                {/* Hold Text Indicator */}
                <span className="relative z-10 flex items-center gap-2">
                  {isHolding ? (
                    <>
                      <span className="animate-spin h-3.5 w-3.5 border-2 border-amber-300 border-t-transparent rounded-full"></span>
                      <span>Unlocking Latch... {Math.round(holdProgress)}%</span>
                    </>
                  ) : (
                    <>
                      <span>Press & Hold to Toggle</span>
                    </>
                  )}
                </span>
              </button>

              <p className="text-[10px] text-slate-500 text-center leading-none mt-1 mb-1 font-semibold">
                * Prevents accidental count interruption taps
              </p>
            </div>

            {/* MODE DISPLAY SIDE 2: WIP */}
            <div className={`flex-1 w-full p-4 rounded-2xl border transition-all ${
              countingMode === "wip" 
                ? "bg-amber-50/40 border-amber-200 shadow-xs" 
                : "bg-slate-50/50 border-slate-100 opacity-60"
            }`}>
              <div className="flex items-center gap-3.5">
                <div className={`p-3 rounded-xl ${
                  countingMode === "wip" ? "bg-amber-600 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-black text-slate-900 leading-none">Work In Progress (WIP)</h3>
                    {countingMode === "wip" && (
                      <span className="text-[9px] font-black uppercase text-amber-850 bg-amber-100 px-1.5 py-0.5 rounded">Active</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">Milled timber stages, assembly joints, sandings, body fillers, and coats</p>
                </div>
              </div>
            </div>

          </div>
        </section>

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
                <AlertTriangle className="w-3 h-3 text-amber-500" /> Must provide Clerk, Zone & Cycle
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            
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

            {/* Date of Count Input & Computed Week */}
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
                {dateOfCount && (
                  <p className="text-emerald-700 text-[11px] mt-1 flex items-center gap-1 font-semibold">
                    <Sparkles className="w-3 h-3 text-emerald-500" /> Automatically computed: {getWeekNumber(dateOfCount) !== "" ? `Week ${getWeekNumber(dateOfCount)}` : "N/A"}
                  </p>
                )}
              </div>
            </div>

            {/* Specify the Cycle Dropdown */}
            <div className={!cycle.trim() ? "ring-2 ring-amber-100 rounded-xl p-1 bg-amber-50/10" : ""}>
              <label htmlFor="cycle-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Specify the Cycle <span className="text-amber-600 font-black">*</span>
              </label>
              <div className="relative font-bold">
                <select
                  id="cycle-input"
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                  className={`w-full bg-slate-50 border text-sm rounded-xl px-3.5 py-2.5 outline-hidden focus:bg-white focus:ring-2 transition-all appearance-none cursor-pointer ${
                    !cycle.trim() 
                      ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-200 text-slate-400' 
                      : 'border-slate-200 focus:border-slate-500 focus:ring-slate-100 text-slate-800'
                  }`}
                >
                  <option value="" className="text-slate-400">Select cycle...</option>
                  <option value="Daily count">Daily count</option>
                  <option value="Weekly count">Weekly count</option>
                  <option value="Monthly count">Monthly count</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
                {!cycle.trim() && (
                  <p className="text-amber-600 text-[11px] mt-1 flex items-center gap-1 font-normal">
                    <AlertTriangle className="w-3 h-3" /> Required for reporting and export headers
                  </p>
                )}
              </div>
            </div>

            {/* Location ID Dropdown */}
            <div className={countingMode === "raw_materials" && !locationId.trim() ? "ring-2 ring-amber-100 rounded-xl p-1 bg-amber-50/10" : ""}>
              <label htmlFor="location-id-input" className={`block text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${countingMode === "wip" ? 'text-slate-400' : 'text-slate-700'}`}>
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                Location ID / Warehouse Zone {countingMode === "raw_materials" && <span className="text-amber-600 font-black">*</span>}
                {countingMode === "wip" && <span className="text-[10px] font-medium text-slate-400 lowercase italic">(disabled for WIP)</span>}
              </label>
              <div className="relative font-bold">
                <select
                  id="location-id-input"
                  value={countingMode === "wip" ? "" : locationId}
                  disabled={countingMode === "wip"}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={`w-full text-sm rounded-xl px-3.5 py-2.5 outline-hidden focus:bg-white focus:ring-2 transition-all appearance-none ${
                    countingMode === "wip"
                      ? 'bg-slate-100/75 border-slate-200 text-slate-400 cursor-not-allowed opacity-65'
                      : !locationId.trim() 
                        ? 'bg-slate-50 border-amber-300 focus:bg-white focus:border-amber-500 focus:ring-amber-200 text-slate-400 cursor-pointer' 
                        : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-slate-500 focus:ring-slate-100 text-slate-800 cursor-pointer'
                  }`}
                >
                  {countingMode === "wip" ? (
                    <option value="">N/A (Process Stage Used Instead)</option>
                  ) : (
                    <>
                      <option value="" className="text-slate-400">Select physical zone...</option>
                      {WAREHOUSE_LOCATIONS.map((loc) => (
                        <option key={loc} value={loc} className="text-slate-800 font-medium">
                          {loc}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {countingMode !== "wip" && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                )}
                {countingMode === "raw_materials" && !locationId.trim() && (
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
          {countingMode === "raw_materials" ? (
            <>
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
            </>
          ) : (
            <>
              {/* WIP COMPONENT LEVEL CONTROLS */}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <ClipboardCheck className="w-5 h-5 text-amber-600 animate-pulse" />
                  <div>
                    <h2 className="text-base font-black text-slate-900 leading-none">Work In Progress Assembly Progress</h2>
                    <span className="text-[11px] text-slate-500 mt-1 block">Click on any process stage card below to filter stage specific components</span>
                  </div>
                </div>

                {/* PRODUCT CATEGORY SELECTOR SLIDER */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-slate-50 p-1.5 border border-slate-200 rounded-2xl w-full md:w-auto">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2 leading-none">Category:</span>
                  <div className="flex flex-wrap gap-1 w-full sm:w-auto">
                    {wipProductCategories.map(pCat => {
                      const isActive = selectedWipProductCategory === pCat;
                      return (
                        <button
                          key={pCat}
                          type="button"
                          onClick={() => setSelectedWipProductCategory(pCat)}
                          className={`text-xs px-3 py-1.5 rounded-xl font-bold transition-all ${
                            isActive 
                              ? "bg-amber-600 border border-amber-600 text-white shadow-xs" 
                              : "bg-white hover:bg-slate-100 text-slate-700 border border-slate-200"
                          }`}
                        >
                          {pCat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Grid 8 Card Blocks for Process stages */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3">
                {wipStageStats.map((stat) => {
                  const isActive = selectedWipStage === stat.stage;
                  return (
                    <button
                      key={stat.stage}
                      onClick={() => setSelectedWipStage(isActive ? "All" : stat.stage)}
                      className={`group text-left border rounded-xl p-3 flex flex-col justify-between transition-all relative overflow-hidden select-none min-h-[105px] ${
                        isActive 
                          ? 'bg-amber-950 border-amber-950 text-white shadow-md ring-2 ring-amber-100' 
                          : stat.percentage === 100 
                            ? 'bg-emerald-50 text-emerald-950 hover:bg-emerald-100/70 hover:border-emerald-300 border-emerald-200' 
                            : stat.percentage === 0
                              ? 'bg-slate-50/50 hover:bg-slate-50 text-slate-800 border-slate-200'
                              : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1 w-full">
                        <p className={`text-[11px] font-black truncate uppercase tracking-tight ${isActive ? 'text-amber-200' : 'text-slate-400'}`}>
                          {stat.stage}
                        </p>
                        <div className="flex items-center justify-between gap-1 pt-1 text-[11px] font-extrabold tracking-tight">
                          <span className={stat.percentage === 100 ? (isActive ? 'text-emerald-100' : 'text-emerald-700') : (isActive ? 'text-slate-300' : 'text-slate-600')}>
                            {stat.counted} of {stat.total} SKUs
                          </span>
                          <span className={isActive ? 'text-amber-300' : 'text-slate-900'}>
                            {stat.percentage}%
                          </span>
                        </div>
                      </div>

                      {/* Visual Progress Slider */}
                      <div className="w-full mt-3">
                        <div className={`h-1.5 w-full rounded-full ${isActive ? 'bg-amber-900' : 'bg-slate-100'} overflow-hidden`}>
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${isActive ? 'bg-amber-400' : stat.percentage === 100 ? 'bg-emerald-600' : 'bg-amber-500'}`}
                            style={{ width: `${stat.percentage}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Completed checkmark badge */}
                      {stat.percentage === 100 && !isActive && (
                        <div className="absolute top-2 right-2 p-0.5 bg-emerald-200 border border-emerald-300 text-emerald-800 rounded-full">
                          <Check className="w-2.5 h-2.5 stroke-[4]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* View all stage indicator row if filters are active */}
              {(selectedWipStage !== "All" || selectedWipProductCategory !== "All") && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => {
                      setSelectedWipStage("All");
                      setSelectedWipProductCategory("All");
                    }}
                    className="text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-xl transition-all"
                  >
                    Clear All WIP Filters
                  </button>
                </div>
              )}
            </>
          )}
        </section>



        {/* PROGRESS HUD & BULK FILE ACTIONS */}
        <section id="progress-hud" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Realtime Completion progress bar */}
          <div className="w-full md:w-1/2 space-y-2">
            <div className="flex justify-between items-end">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Count Progress Status</span>
                <span className="text-xl font-extrabold text-slate-950 tracking-tight">
                  {completedCount} <span className="text-sm font-semibold text-slate-400">of</span> {totalItems}
                </span>
                <span className="text-xs text-slate-500 mx-2">
                  {countingMode === "raw_materials" ? "raw materials listed" : "WIP items listed"}
                </span>
              </div>
              <span className={`text-sm font-extrabold px-2.5 py-1 rounded-lg border transition-all ${
                countingMode === "wip" 
                  ? "text-amber-800 bg-amber-50 border-amber-200" 
                  : "text-slate-900 bg-slate-100 border-slate-200"
              }`}>
                {completionPercentage}% Complete
              </span>
            </div>
            
            {/* Premium progress bar graphic */}
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200 flex">
              <div 
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  countingMode === "wip" ? "bg-amber-500" : "bg-slate-900"
                }`}
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
              <span className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none transition-colors duration-200 ${
                countingMode === "wip" ? "text-amber-500" : "text-slate-400"
              }`}>
                <Search className="w-4 h-4" />
              </span>
              <input
                id="search-materials-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={countingMode === "raw_materials" ? "Search raw materials by part, description..." : "Search WIP by stage, description..."}
                className={`w-full bg-white border rounded-xl pl-9 pr-14 py-2 text-sm text-slate-800 placeholder-slate-400 outline-hidden transition-all font-semibold ${
                  countingMode === "wip"
                    ? 'border-amber-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                    : 'border-slate-200 focus:border-slate-500 focus:ring-1 focus:ring-slate-500'
                }`}
              />
              <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 pr-2">
                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border select-none transition-all duration-200 ${
                  countingMode === "wip" 
                    ? "bg-amber-100 text-amber-700 border-amber-200" 
                    : "bg-slate-100 text-slate-500 border-slate-200"
                }`}>
                  {countingMode === "wip" ? "WIP" : "RM"}
                </span>
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery("")}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
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
                Blank ({totalItems - completedCount})
              </button>
            </div>

          </div>

          {/* Active Category Filter Ribbon indicators */}
          {countingMode === "raw_materials" ? (
            selectedCategory !== "All" && (
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
            )
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedWipStage !== "All" && (
                <div className="flex items-center gap-2 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200 w-fit">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Stage Filter:</span>
                  <span className="text-xs font-extrabold text-slate-900">{selectedWipStage}</span>
                  <button 
                    onClick={() => setSelectedWipStage("All")}
                    className="text-slate-400 hover:text-slate-900 p-0.5 rounded-md hover:bg-slate-200 transition-colors"
                    title="Clears specific stage restriction"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {selectedWipProductCategory !== "All" && (
                <div className="flex items-center gap-2 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200 w-fit">
                  <span className="text-[11px] font-bold text-slate-400 uppercase">Product Family:</span>
                  <span className="text-xs font-extrabold text-slate-900">{selectedWipProductCategory}</span>
                  <button 
                    onClick={() => setSelectedWipProductCategory("All")}
                    className="text-slate-400 hover:text-slate-900 p-0.5 rounded-md hover:bg-slate-200 transition-colors"
                    title="Clears specific category restriction"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
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
                    {countingMode === "raw_materials" ? "Raw Material Specification" : "WIP Component Description & Stage"}
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
                        <p className="text-sm font-bold text-slate-700">No {countingMode === "raw_materials" ? "raw materials" : "WIP items"} matched criteria.</p>
                        <p className="text-xs">Adjust search query or category filters to inspect other SKUs.</p>
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
                          <div className="space-y-1.5 max-w-xl">
                            <p className="text-xs font-semibold text-slate-900 leading-relaxed">
                              {material.description}
                            </p>
                            {countingMode === "wip" && (
                              <div className="flex flex-wrap gap-1 items-center">
                                <span className="text-[9px] font-black uppercase bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
                                  {(material as any).subCategory}
                                </span>
                                <span className="text-slate-300 text-[10px]">•</span>
                                <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded border border-slate-200">
                                  {(material as any).processStage}
                                </span>
                              </div>
                            )}
                          </div>
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
              of <span className="text-slate-800">{totalFilteredCount}</span> {countingMode === "raw_materials" ? "matched materials" : "matched WIP items"}
              {countingMode === "raw_materials" 
                ? (selectedCategory !== "All" && ` in ${selectedCategory}`)
                : ((selectedWipProductCategory !== "All" || selectedWipStage !== "All") && 
                    ` in ${selectedWipProductCategory !== "All" ? selectedWipProductCategory : "All Categories"} ${selectedWipStage !== "All" ? `(${selectedWipStage})` : ""}`
                  )
              }
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
              <div className="grid grid-cols-2 md:grid-cols-4 bg-slate-50 p-4 border border-slate-200 rounded-xl gap-4">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Primary Data Clerk</span>
                  <span className="block text-slate-900 font-bold mt-1 text-xs sm:text-sm truncate">{clerkName}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Warehouse Zone</span>
                  <span className="block text-slate-900 font-bold mt-1 text-xs sm:text-sm truncate">{locationId.toUpperCase()}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Effective Count Date</span>
                  <span className="block text-slate-900 font-bold mt-1 text-xs sm:text-sm truncate">{dateOfCount}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Cycle & Week</span>
                  <span className="block text-slate-900 font-bold mt-1 text-xs sm:text-sm truncate">{cycle} ({getWeekNumber(dateOfCount) !== "" ? `Week ${getWeekNumber(dateOfCount)}` : "N/A"})</span>
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
