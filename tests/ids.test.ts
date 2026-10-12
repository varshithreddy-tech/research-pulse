import { describe, expect, it } from "vitest";
import { classifyUrl, findPaperLinks, findCodeUrl, publisherDoi, bareArxivId } from "@/lib/ids";

describe("paper links", () => {
  it("recognises every supported site", () => {
    expect(classifyUrl("https://arxiv.org/abs/2410.01234v3")).toMatchObject({ kind: "arxiv", id: "2410.01234" });
    expect(classifyUrl("https://arxiv.org/pdf/2410.01234")).toMatchObject({ kind: "arxiv", id: "2410.01234" });
    expect(classifyUrl("https://openreview.net/forum?id=AbC_12-x")).toMatchObject({ kind: "openreview", id: "AbC_12-x" });
    expect(classifyUrl("https://aclanthology.org/2024.acl-long.123/")).toMatchObject({ kind: "acl", id: "2024.acl-long.123" });
    expect(classifyUrl("https://aclanthology.org/2024.emnlp-main.5.pdf")).toMatchObject({ kind: "acl", id: "2024.emnlp-main.5" });
    expect(classifyUrl("https://ieeexplore.ieee.org/document/10123456")).toMatchObject({ kind: "ieee", id: "10123456" });
    expect(classifyUrl("https://dl.acm.org/doi/10.1145/3589334.3645123")).toMatchObject({ kind: "doi", id: "10.1145/3589334.3645123" });
    expect(classifyUrl("https://doi.org/10.1109/CVPR52733.2024.00123")).toMatchObject({ kind: "doi", id: "10.1109/cvpr52733.2024.00123" });
    expect(classifyUrl("https://openaccess.thecvf.com/content/CVPR2024/html/Smith_Foo_CVPR_2024_paper.html")?.kind).toBe("cvf");
  });

  it("treats arXiv's own DOI as an arXiv paper, not a publisher DOI", () => {
    expect(classifyUrl("https://doi.org/10.48550/arXiv.2410.01234")).toMatchObject({ kind: "arxiv", id: "2410.01234" });
    expect(publisherDoi("10.48550/arXiv.2310.06770")).toBeNull();
    expect(publisherDoi("10.1145/123.456.")).toBe("10.1145/123.456");
  });

  it("ignores pages that are not papers", () => {
    expect(classifyUrl("https://openreview.net/group?id=ICLR.cc/2026/Conference")).toBeNull();
    expect(classifyUrl("https://aclanthology.org/events/acl-2024/")).toBeNull();
    expect(classifyUrl("https://example.com/blog/post")).toBeNull();
  });

  it("finds links in blog markdown, de-duplicated, never inventing any", () => {
    const md = `We read [the paper](https://arxiv.org/abs/2501.00001v2) (also arXiv:2501.00001) and
      the follow-up https://arxiv.org/pdf/2501.00002.pdf plus doi: 10.1038/s41586-024-07000-1.`;
    const links = findPaperLinks(md);
    expect(links.map((l) => `${l.kind}:${l.id}`)).toEqual(["arxiv:2501.00001", "arxiv:2501.00002", "doi:10.1038/s41586-024-07000-1"]);
    expect(findPaperLinks("No papers here, just https://example.com")).toEqual([]);
  });

  it("finds code links and strips arXiv versions", () => {
    expect(findCodeUrl("Code: https://github.com/org/repo.")).toBe("https://github.com/org/repo");
    expect(findCodeUrl("no code")).toBeNull();
    expect(bareArxivId("2410.01234v7")).toBe("2410.01234");
  });
});
