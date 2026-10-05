// RDKit ETKDGv3 / MMFF94 browser bridge. Atom order from the input is retained.
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <GraphMol/FileParsers/FileParsers.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/DistGeomHelpers/BoundsMatrixBuilder.h>
#include <DistGeom/TriangleSmooth.h>
#include <GraphMol/PeriodicTable.h>
#include <GraphMol/RingInfo.h>
#include <GraphMol/ForceFieldHelpers/MMFF/MMFF.h>
#include <GraphMol/Conformer.h>
#include <GraphMol/SmilesParse/SmilesWrite.h>
#include <RDGeneral/versions.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <memory>
#include <map>
#include <sstream>
#include <stdexcept>

std::string jsonString(const std::string &value) {
  std::string result = "\"";
  for (const char c : value) {
    if (c == '\\' || c == '"') result += '\\';
    if (c == '\n' || c == '\r') result += ' '; else result += c;
  }
  return result + "\"";
}
std::pair<std::string, std::string> substitutionSmiles(const RDKit::ROMol &source, int confId = -1, int hydrogen = -1, int secondHydrogen = -1) {
  RDKit::RWMol marked(source);
  for (auto atom : marked.atoms()) atom->setAtomMapNum(0);
  if (hydrogen >= 0) {
    auto atom = marked.getAtomWithIdx(hydrogen);
    unsigned marker = 2;
    for (const auto other : marked.atoms()) {
      if (other->getAtomicNum() == 1) marker = std::max(marker, other->getIsotope() + 1);
    }
    atom->setIsotope(marker);
    if (secondHydrogen >= 0) marked.getAtomWithIdx(secondHydrogen)->setIsotope(marker);
  }
  if (confId >= 0) RDKit::MolOps::assignStereochemistryFrom3D(marked, confId, true);
  RDKit::MolOps::removeHs(marked);
  const std::string original = RDKit::MolToSmiles(marked);
  for (auto atom : marked.atoms()) {
    if (atom->getChiralTag() == RDKit::Atom::CHI_TETRAHEDRAL_CW ||
        atom->getChiralTag() == RDKit::Atom::CHI_TETRAHEDRAL_CCW) atom->invertChirality();
  }
  return {original, RDKit::MolToSmiles(marked)};
}
std::string hydrogenKey(const RDKit::ROMol &mol, int confId, int atom, bool achiral) {
  const auto smiles = substitutionSmiles(mol, confId, atom);
  return achiral ? std::min(smiles.first, smiles.second) : smiles.first;
}

std::string generateImpl(const std::string &block, int count, int seed,
                     emscripten::val progress) {
  if (count < 1 || count > 10) throw std::runtime_error("Request 1 to 10 conformers");
  std::unique_ptr<RDKit::RWMol> mol(RDKit::MolBlockToMol(block, true, false, true));
  if (!mol || mol->getNumAtoms() == 0) throw std::runtime_error("Invalid or empty molfile");
  const auto originalCount = mol->getNumAtoms();
  if (originalCount > 256) throw std::runtime_error("CASCADE supports at most 256 input atoms");
  RDKit::MolOps::addHs(*mol);
  const auto originalStereo = substitutionSmiles(*mol);
  const bool originalAchiral = originalStereo.first == originalStereo.second;
  // Upstream coupling features inspect the sanitized graph, with MMFF atom
  // typing on a copy because MMFF aromaticity perception mutates atom flags.
  RDKit::RWMol typingMol(*mol);
  RDKit::MMFF::MMFFMolProperties properties(typingMol, "MMFF94");
  if (!properties.isValid()) throw std::runtime_error("MMFF94 parameters unavailable for this molecule");
  std::ostringstream graph;
  graph << std::setprecision(17) << "\"atomDescriptors\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) {
    if (i) graph << ',';
    const auto atom = typingMol.getAtomWithIdx(i);
    graph << "{\"atomicNumber\":" << atom->getAtomicNum()
      << ",\"totalValence\":" << atom->getTotalValence()
      << ",\"aromatic\":" << (atom->getIsAromatic() ? "true" : "false")
      << ",\"hybridization\":" << static_cast<int>(atom->getHybridization())
      << ",\"formalCharge\":" << atom->getFormalCharge()
      << ",\"defaultValence\":" << RDKit::PeriodicTable::getTable()->getDefaultValence(atom->getAtomicNum())
      << ",\"chiralTag\":" << static_cast<int>(atom->getChiralTag())
      << ",\"mmffAtomType\":" << static_cast<int>(properties.getMMFFAtomType(i))
      << ",\"ringSizes\":[";
    bool first = true;
    for (int size = 3; size <= 7; ++size) {
      if (mol->getRingInfo()->isAtomInRingOfSize(i, size)) {
        if (!first) graph << ','; graph << size; first = false;
      }
    }
    graph << "]}";
  }
  graph << "],\"bonds\":[";
  bool firstBond = true;
  for (const auto bond : mol->bonds()) {
    if (!firstBond) graph << ','; firstBond = false;
    graph << '[' << bond->getBeginAtomIdx() << ',' << bond->getEndAtomIdx() << ',' << bond->getBondTypeAsDouble() << ']';
  }
  DistGeom::BoundsMatPtr bounds(new DistGeom::BoundsMatrix(mol->getNumAtoms()));
  RDKit::DGeomHelpers::initBoundsMat(bounds);
  RDKit::DGeomHelpers::setTopolBounds(*mol, bounds, true, false, false);
  DistGeom::triangleSmoothBounds(bounds);
  graph << "],\"boundsMatrix\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) {
    if (i) graph << ','; graph << '[';
    for (unsigned j = 0; j < mol->getNumAtoms(); ++j) {
      if (j) graph << ',';
      graph << bounds->getData()[i * mol->getNumAtoms() + j];
    }
    graph << ']';
  }
  graph << ']';
  auto parameters = RDKit::DGeomHelpers::ETKDGv3;
  parameters.randomSeed = seed;
  parameters.pruneRmsThresh = 0.5;
  parameters.numThreads = 1;
  // Match Python ETKDGv3 defaults. Its historical maxAttempts assignment is
  // not an active EmbedParameters field in RDKit 2025.09.1.
  progress(std::string("embedding"), 0, count);
  const auto ids = RDKit::DGeomHelpers::EmbedMultipleConfs(*mol, count, parameters);
  if (ids.empty()) throw std::runtime_error("ETKDGv3 failed to embed a conformer");
  struct Result { int id; int status; double energy; };
  std::vector<Result> results;
  progress(std::string("optimizing"), 0, static_cast<int>(ids.size()));
  std::vector<std::pair<int, double>> optimized;
  RDKit::MMFF::MMFFOptimizeMoleculeConfs(*mol, optimized, 1, 500, "MMFF94", 10.0, true);
  for (std::size_t i = 0; i < ids.size(); ++i) {
    const auto result = optimized[i];
    if (result.first < 0 || !std::isfinite(result.second)) throw std::runtime_error("MMFF94 optimization failed");
    results.push_back({ids[i], result.first, result.second});
  }
  std::stable_sort(results.begin(), results.end(), [](const Result &a, const Result &b) { return a.energy < b.energy; });
  // Atom slots remain in source order. For same-parent, same-isotope H, each
  // conformer must associate the same physical site with the same slot before
  // per-atom model predictions are averaged. ETKDG does not guarantee that.
  std::vector<std::string> hydrogenSiteKeys(mol->getNumAtoms());
  std::vector<std::string> physicalSiteKeys(mol->getNumAtoms());
  std::map<std::pair<unsigned,unsigned>,std::vector<unsigned>> hydrogenGroups;
  for (const auto atom : mol->atoms()) {
    const auto index = atom->getIdx();
    if (atom->getAtomicNum() != 1) continue;
    hydrogenSiteKeys[index] = hydrogenKey(*mol, results.front().id, index, originalAchiral);
    // Enantiotopic sites are chemically equivalent but their relative pair
    // relationships matter for magnetic equivalence. Align raw physical
    // identities; collapse mirrors only in the exported chemical keys.
    physicalSiteKeys[index] = hydrogenKey(*mol, results.front().id, index, false);
    for (const auto parent : mol->atomNeighbors(atom)) {
      hydrogenGroups[{parent->getIdx(),atom->getIsotope()}].push_back(index); break;
    }
  }
  for (std::size_t c = 1; c < results.size(); ++c) {
    auto &conf = mol->getConformer(results[c].id);
    for (const auto &[parentAndIsotope,group] : hydrogenGroups) {
      (void) parentAndIsotope;
      std::vector<std::string> currentKeys;
      std::vector<RDGeom::Point3D> positions;
      for (const auto atom : group) {
        currentKeys.push_back(hydrogenKey(*mol, results[c].id, atom, false));
        positions.push_back(conf.getAtomPos(atom));
      }
      std::vector<bool> used(group.size(), false);
      for (const auto atom : group) {
        std::size_t found = group.size();
        for (std::size_t k = 0; k < group.size(); ++k) {
          if (!used[k] && currentKeys[k] == physicalSiteKeys[atom]) { found = k; break; }
        }
        if (found == group.size()) throw std::runtime_error("Conformers disagree on stereochemistry; specify the molecule's stereocenters");
        used[found] = true;
        conf.setAtomPos(atom, positions[found]);
      }
    }
  }
  std::ostringstream pairKeys;
  pairKeys << "\"hydrogenPairEquivalence\":[";
  bool firstPair = true;
  // The learned J domain is at most 64 explicit atoms and natural/1H pairs
  // separated by two to four graph bonds. A double replacement preserves
  // symmetry-related pairs without erasing AA'BB' magnetic nonequivalence.
  if (mol->getNumAtoms() <= 64) {
    for (unsigned a = 0; a < mol->getNumAtoms(); ++a) {
      const auto atomA = mol->getAtomWithIdx(a);
      if (atomA->getAtomicNum() != 1 || atomA->getIsotope() >= 2) continue;
      std::vector<int> distances(mol->getNumAtoms(), -1);
      std::vector<unsigned> queue{a}; distances[a] = 0;
      for (std::size_t head = 0; head < queue.size(); ++head) {
        const auto current = queue[head];
        if (distances[current] >= 4) continue;
        for (const auto next : mol->atomNeighbors(mol->getAtomWithIdx(current))) {
          const auto index = next->getIdx();
          if (distances[index] >= 0) continue;
          distances[index] = distances[current] + 1; queue.push_back(index);
        }
      }
      for (unsigned b = a + 1; b < mol->getNumAtoms(); ++b) {
        const auto atomB = mol->getAtomWithIdx(b);
        if (atomB->getAtomicNum() != 1 || atomB->getIsotope() >= 2 || distances[b] < 2 || distances[b] > 4) continue;
        const auto smiles = substitutionSmiles(*mol, results.front().id, a, b);
        const auto key = originalAchiral ? std::min(smiles.first, smiles.second) : smiles.first;
        if (!firstPair) pairKeys << ','; firstPair = false;
        pairKeys << "{\"atomIndices\":[" << a << ',' << b << "],\"key\":" << jsonString(key) << '}';
      }
    }
  }
  pairKeys << ']';
  std::ostringstream out;
  out << std::setprecision(17);
  out << "{\"rdkitVersion\":\"" << RDKit::rdkitVersion << "\",\"method\":\"ETKDGv3/MMFF94\",\"randomSeed\":" << seed << ",\"originalAtomCount\":" << originalCount << ",\"atomicNumbers\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) { if (i) out << ','; out << mol->getAtomWithIdx(i)->getAtomicNum(); }
  out << "],\"atomIsotopes\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) { if (i) out << ','; out << mol->getAtomWithIdx(i)->getIsotope(); }
  out << "],\"originalAtomIndices\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) { if (i) out << ','; out << (i < originalCount ? static_cast<int>(i) : -1); }
  out << "],\"hydrogenParents\":[";
  for (unsigned i = 0; i < mol->getNumAtoms(); ++i) {
    if (i) out << ',';
    const auto atom = mol->getAtomWithIdx(i);
    int parent = -1;
    if (atom->getAtomicNum() == 1) {
      for (const auto neighbor : mol->atomNeighbors(atom)) { parent = neighbor->getIdx(); break; }
    }
    out << parent;
  }
  out << "],\"hydrogenSiteKeys\":[";
  for (unsigned i = 0; i < hydrogenSiteKeys.size(); ++i) { if (i) out << ','; out << jsonString(hydrogenSiteKeys[i]); }
  out << "],\"hydrogenIdentityMethod\":\"3D isotope replacement / canonical isomeric SMILES\",\"hydrogenAlignmentWarnings\":[";
  out << "]," << pairKeys.str() << ',' << graph.str() << ",\"conformers\":[";
  for (std::size_t i = 0; i < results.size(); ++i) {
    if (i) out << ',';
    const auto &result = results[i];
    const auto &conf = mol->getConformer(result.id);
    out << "{\"id\":" << result.id << ",\"energyKcal\":" << result.energy << ",\"converged\":" << (result.status == 0 ? "true" : "false") << ",\"coordinates\":[";
    for (unsigned j = 0; j < mol->getNumAtoms(); ++j) {
      if (j) out << ',';
      const auto &p = conf.getAtomPos(j);
      if (!std::isfinite(p.x) || !std::isfinite(p.y) || !std::isfinite(p.z)) throw std::runtime_error("Nonfinite conformer coordinates");
      out << '[' << p.x << ',' << p.y << ',' << p.z << ']';
    }
    out << "]}";
  }
  out << "]}";
  progress(std::string("complete"), static_cast<int>(ids.size()), static_cast<int>(ids.size()));
  return out.str();
}
std::string generate(const std::string &block, int count, int seed, emscripten::val progress) {
  try { return generateImpl(block, count, seed, progress); }
  catch (const std::exception &error) {
    std::string message;
    for (const char c : std::string(error.what())) {
      if (c == '\\' || c == '"') message += '\\';
      if (c == '\n' || c == '\r') message += ' '; else message += c;
    }
    return "{\"error\":\"" + message + "\"}";
  }
}
EMSCRIPTEN_BINDINGS(webnmr_conformers) { emscripten::function("generate", &generate); }
